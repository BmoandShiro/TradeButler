import { useEffect, useState, useRef, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/tauri";
import { Plus, Edit2, Trash2, FileText, X, RotateCcw, Maximize2, Minimize2, Link2, ChevronDown, ChevronRight, BarChart3, Search } from "lucide-react";
import { format, parse } from "date-fns";
import RichTextEditor from "../components/RichTextEditor";
import { TradeChart } from "../components/TradeChart";
import { saveAllScrollPositions, restoreAllScrollPositions } from "../utils/scrollManager";

interface JournalEntry {
  id: number;
  date: string;
  title: string;
  strategy_id: number | null;
  created_at: string | null;
  updated_at: string | null;
  linked_trade_ids?: string | null;
}

interface JournalTrade {
  id: number;
  journal_entry_id: number;
  symbol: string | null;
  position: string | null;
  timeframe: string | null;
  entry_type: string | null;
  exit_type: string | null;
  trade: string | null;
  what_went_well: string | null;
  what_could_be_improved: string | null;
  emotional_state: string | null;
  notes: string | null;
  outcome: string | null;
  trade_order: number;
  created_at: string | null;
  updated_at: string | null;
}

/** Actual trade from the Trades table (executed/real trades), not journal trades */
interface ActualTrade {
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

interface Strategy {
  id: number;
  name: string;
  description: string | null;
  notes: string | null;
  created_at: string | null;
  color: string | null;
}

interface ChecklistItem {
  id: number;
  strategy_id: number;
  item_text: string;
  is_checked: boolean;
  item_order: number;
  checklist_type: string;
  parent_id: number | null;
}

interface JournalChecklistResponse {
  id: number | null;
  journal_entry_id: number;
  checklist_item_id: number;
  is_checked: boolean;
  journal_trade_ids?: string | null; // JSON array of trade IDs when associated with specific trades, null = whole entry
}

const ENTRY_LEVEL_CHECKLIST_TYPES = ["daily_analysis", "daily_mantra"];

  /** Emotional state from Emotions (linked to journal entry/implementation) */
interface JournalEmotionalState {
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

const JOURNAL_EMOTIONS = [
  "Confident", "Anxious", "Frustrated", "Excited", "Calm", "Greedy", "Fearful",
  "Optimistic", "Pessimistic", "Neutral",
];

const DEFAULT_EMOTION_INTENSITY = 0;

const INTENSITY_SCALE_LABEL = "0 = not present → 10 = extremely strong. Rate how strongly you feel each emotion; values are used for trends and insights over time.";

const INTENSITY_LABELS: Record<number, string> = {
  0: "None", 1: "Barely", 2: "Slight", 3: "Mild", 4: "Moderate", 5: "Noticeable",
  6: "Strong", 7: "Very strong", 8: "Intense", 9: "Severe", 10: "Extreme",
};

/** Group emotional states by timestamp (same timestamp = one entry with shared notes). */
function groupEmotionalStatesByTimestamp(states: JournalEmotionalState[]): JournalEmotionalState[][] {
  const byTs = new Map<string, JournalEmotionalState[]>();
  for (const s of states) {
    const key = s.timestamp;
    if (!byTs.has(key)) byTs.set(key, []);
    byTs.get(key)!.push(s);
  }
  return Array.from(byTs.values()).sort(
    (a, b) => new Date(b[0].timestamp).getTime() - new Date(a[0].timestamp).getTime()
  );
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

type TabType = "trade" | "what_went_well" | "what_could_be_improved" | "links" | "emotional_state" | "notes" | "checklists" | "survey";

export default function Journal() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [journalEntriesPage, setJournalEntriesPage] = useState(1);
  const [journalEntriesSort, setJournalEntriesSort] = useState<"newest" | "oldest">("newest");
  const JOURNAL_ENTRIES_PAGE_SIZE = 25;
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(() => {
    // Try to restore selected entry ID from localStorage
    const savedId = localStorage.getItem('journal_selected_entry_id');
    return savedId ? null : null; // Will be loaded by ID in useEffect
  });
  const [selectedTrades, setSelectedTrades] = useState<JournalTrade[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [activeTradeIndex, setActiveTradeIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<TabType>("trade");
  const [loading, setLoading] = useState(true);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isTabContentMaximized, setIsTabContentMaximized] = useState(false);
  const [linkedPairs, setLinkedPairs] = useState<PairedTrade[]>([]);
  const [showLinkPairsModal, setShowLinkPairsModal] = useState(false);
  const [selectedPairForChart, setSelectedPairForChart] = useState<PairedTrade | null>(null);
  const [allPairsForPicker, setAllPairsForPicker] = useState<PairedTrade[]>([]);
  const [linkPickerSelected, setLinkPickerSelected] = useState<Set<string>>(new Set());
  const [linkPairsSearchQuery, setLinkPairsSearchQuery] = useState("");
  const [linkPairsSortBy, setLinkPairsSortBy] = useState<"date" | "symbol" | "pnl">("date");
  const [linkPairsSortDirection, setLinkPairsSortDirection] = useState<"asc" | "desc">("desc");
  const [savingLinkPairs, setSavingLinkPairs] = useState(false);
  
  // Entry-level form state
  const [entryFormData, setEntryFormData] = useState({
    date: format(new Date(), "yyyy-MM-dd"),
    title: "",
    strategy_id: null as number | null,
    linked_trade_ids: [] as number[],
    /** One state id per emotional state group to link this journal to (used when creating or editing). */
    linked_emotional_state_ids: [] as number[],
    /** When linking existing states: scope per state id (for save / edit sync). */
    linked_emotional_state_link_scopes: {} as Record<number, { scope: "entry" | "trades"; tradeIndex: number | null }>,
  });

  // Trade-level form state (array of trades)
  const [tradesFormData, setTradesFormData] = useState<Array<{
    id: number | null;
    symbol: string;
    position: string;
    timeframe: string;
    entry_type: string;
    exit_type: string;
    trade: string;
    what_went_well: string;
    what_could_be_improved: string;
    emotional_state: string;
    notes: string;
    outcome: string;
    trade_order: number;
  }>>([{
    id: null,
    symbol: "",
    position: "",
    timeframe: "",
    entry_type: "",
    exit_type: "",
    trade: "",
    what_went_well: "",
    what_could_be_improved: "",
    emotional_state: "",
    notes: "",
    outcome: "Positive",
    trade_order: 0,
  }]);

  // Checklist state (per trade, but checklists come from strategy)
  const [strategyChecklists, setStrategyChecklists] = useState<Map<number, Map<string, ChecklistItem[]>>>(new Map());
  const [checklistResponses, setChecklistResponses] = useState<Map<number, Map<number, boolean>>>(new Map()); // trade_index -> checklist_item_id -> is_checked
  // Entry-level (Analysis & Mantra): associated with whole journal by default, optionally with specific trades
  const [entryLevelChecklistResponses, setEntryLevelChecklistResponses] = useState<Map<number, boolean>>(new Map()); // item_id -> is_checked
  const [checklistTradeAssociations, setChecklistTradeAssociations] = useState<Map<number, number[] | null>>(new Map()); // item_id -> null (whole entry) or [trade_id, ...]
  const [tradeAssociationModalItemId, setTradeAssociationModalItemId] = useState<number | null>(null);

  // Journal trade -> actual trades (link journal trades in entry to real trades from Trades table)
  const [journalTradeActualTradeIds, setJournalTradeActualTradeIds] = useState<Map<number, number[]>>(new Map()); // journal_trade_id -> [actual trade id, ...]
  const [actualTrades, setActualTrades] = useState<ActualTrade[]>([]); // all actual trades for "Link to actual trades" modal
  const [linkActualTradesModalJournalTradeId, setLinkActualTradesModalJournalTradeId] = useState<number | null>(null);
  const [linkActualTradesSelection, setLinkActualTradesSelection] = useState<number[]>([]); // selection in "Link to actual trades" modal

  // Emotional states linked to this journal entry/implementation (same as Emotions page)
  const [journalEmotionalStates, setJournalEmotionalStates] = useState<JournalEmotionalState[]>([]);
  const [showAddEmotionalStateForm, setShowAddEmotionalStateForm] = useState(false);
  const [newEmotionalStateForm, setNewEmotionalStateForm] = useState<{ selectedEmotions: Record<string, number>; notes: string }>({ selectedEmotions: {}, notes: "" });
  const [newEmotionalStateLinkScope, setNewEmotionalStateLinkScope] = useState<"entry" | "trades">("entry");
  const [newEmotionalStateTradeIndices, setNewEmotionalStateTradeIndices] = useState<number[]>([]);
  // Pending emotional state entries (tradeIndex -1 = entire journal, >= 0 = that trade only; one state per scope)
  const [pendingEmotionalStates, setPendingEmotionalStates] = useState<Array<{ tradeIndex: number; selectedEmotions: Record<string, number>; notes: string }>>([]);
  
  // Available symbols for dropdown
  const [availableSymbols, setAvailableSymbols] = useState<string[]>([]);
  
  // Modal state
  const [showTitleRequiredModal, setShowTitleRequiredModal] = useState(false);
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  const [emotionalStateDeleteTarget, setEmotionalStateDeleteTarget] = useState<null | { type: "saved"; states: JournalEmotionalState[] } | { type: "pending"; tradeIndex: number; idx: number }>(null);
  // View mode: emotional states for the selected entry (when not editing), and whether the section is expanded
  const [viewEntryEmotionalStates, setViewEntryEmotionalStates] = useState<JournalEmotionalState[]>([]);
  const [emotionalStatesSectionExpanded, setEmotionalStatesSectionExpanded] = useState(false);
  // For "Link to emotional states" / "Link to real trades" from Journal (entry-level)
  const [allEmotionalStates, setAllEmotionalStates] = useState<JournalEmotionalState[]>([]);
  const [realTradesForLink, setRealTradesForLink] = useState<{ id: number; symbol: string; side: string; timestamp: string; quantity: number; pnl?: number }[]>([]);
  const [journalLinksStateDropdownOpen, setJournalLinksStateDropdownOpen] = useState(false);
  const [journalLinksTradeDropdownOpen, setJournalLinksTradeDropdownOpen] = useState(false);
  const [linkExistingEmotionalStateScope, setLinkExistingEmotionalStateScope] = useState<"entry" | "trades">("entry");
  const [linkExistingEmotionalStateTradeIndex, setLinkExistingEmotionalStateTradeIndex] = useState<number | null>(null);
  const journalLinksStateDropdownRef = useRef<HTMLDivElement>(null);
  const journalLinksTradeDropdownRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  
  // Edit history for undo functionality
  const [editHistory, setEditHistory] = useState<Array<{
    entry: { date: string; title: string; strategy_id: number | null };
    trades: Array<{
      id: number | null;
      symbol: string;
      position: string;
      timeframe: string;
      entry_type: string;
      exit_type: string;
      trade: string;
      what_went_well: string;
      what_could_be_improved: string;
      emotional_state: string;
      notes: string;
      outcome: string;
      trade_order: number;
    }>;
    checklistResponses: Map<number, Map<number, boolean>>;
  }>>([]);
  
  // Store original state when starting to edit
  const [, setOriginalEntryData] = useState<{
    entry: { date: string; title: string; strategy_id: number | null };
    trades: Array<{
      id: number | null;
      symbol: string;
      position: string;
      timeframe: string;
      entry_type: string;
      exit_type: string;
      trade: string;
      what_went_well: string;
      what_could_be_improved: string;
      emotional_state: string;
      notes: string;
      outcome: string;
      trade_order: number;
    }>;
    checklistResponses: Map<number, Map<number, boolean>>;
  } | null>(null);

  // Store scroll positions for each tab
  const tabScrollPositions = useRef<Map<TabType, number>>(new Map());
  const tabContentRefs = useRef<Map<TabType, HTMLDivElement | null>>(new Map());
  const leftPanelScrollRef = useRef<HTMLDivElement>(null);

  // Save work-in-progress to localStorage
  const saveWorkInProgress = () => {
    if (isCreating || isEditing) {
      const workInProgress = {
        entryFormData,
        tradesFormData,
        checklistResponses: Array.from(checklistResponses.entries()).map(([tradeIndex, responses]) => [
          tradeIndex,
          Array.from(responses.entries())
        ]),
        entryLevelChecklistResponses: Array.from(entryLevelChecklistResponses.entries()),
        checklistTradeAssociations: Array.from(checklistTradeAssociations.entries()).map(([k, v]) => [k, v]),
        activeTradeIndex,
        activeTab,
        isCreating,
        isEditing,
        selectedEntryId: selectedEntry?.id || null,
        scrollPositions: Array.from(tabScrollPositions.current.entries()),
      };
      localStorage.setItem('journal_work_in_progress', JSON.stringify(workInProgress));
    }
  };

  // Restore work-in-progress from localStorage
  const restoreWorkInProgress = () => {
    try {
      const saved = localStorage.getItem('journal_work_in_progress');
      if (saved) {
        const workInProgress = JSON.parse(saved);
        setEntryFormData(workInProgress.entryFormData);
        setTradesFormData(workInProgress.tradesFormData);
        
        // Restore checklist responses
        const restoredResponses = new Map<number, Map<number, boolean>>();
        workInProgress.checklistResponses.forEach(([tradeIndex, responses]: [number, [number, boolean][]]) => {
          restoredResponses.set(tradeIndex, new Map(responses));
        });
        setChecklistResponses(restoredResponses);
        if (workInProgress.entryLevelChecklistResponses) {
          setEntryLevelChecklistResponses(new Map(workInProgress.entryLevelChecklistResponses));
        }
        if (workInProgress.checklistTradeAssociations) {
          setChecklistTradeAssociations(new Map(workInProgress.checklistTradeAssociations.map(([k, v]: [number, number[] | null]) => [k, v])));
        }
        
        setActiveTradeIndex(workInProgress.activeTradeIndex);
        setActiveTab(workInProgress.activeTab);
        setIsCreating(workInProgress.isCreating);
        setIsEditing(workInProgress.isEditing);
        
        // Restore scroll positions
        workInProgress.scrollPositions.forEach(([tab, pos]: [TabType, number]) => {
          tabScrollPositions.current.set(tab, pos);
        });
        
        // If editing an existing entry, load it. Pass restored count so we sync from DB if saved state was bloated.
        if (workInProgress.selectedEntryId && !workInProgress.isCreating) {
          loadEntry(workInProgress.selectedEntryId, {
            skipTradesFormDataSync: true,
            restoredTradesCount: workInProgress.tradesFormData?.length,
          });
        }
        
        // Load strategy checklists if needed
        if (workInProgress.entryFormData.strategy_id) {
          loadStrategyChecklists(workInProgress.entryFormData.strategy_id);
        }
      }
    } catch (error) {
      console.error("Error restoring work in progress:", error);
    }
  };

  // Clear work-in-progress from localStorage
  const clearWorkInProgress = () => {
    localStorage.removeItem('journal_work_in_progress');
  };

  // Get storage key for current entry (entry-specific scroll positions)
  const getScrollStorageKey = () => {
    if (selectedEntry?.id) {
      return `journal_entry_${selectedEntry.id}`;
    }
    return "journal"; // Fallback to global if no entry selected
  };

  // Save scroll position when switching tabs
  const handleTabChange = (newTab: TabType) => {
    // Save current tab's scroll position
    const currentTabContent = tabContentRefs.current.get(activeTab);
    if (currentTabContent) {
      tabScrollPositions.current.set(activeTab, currentTabContent.scrollTop);
    }
    
    // Save all scroll positions to localStorage before switching (entry-specific)
    const storageKey = getScrollStorageKey();
    saveAllScrollPositions(
      tabScrollPositions.current,
      leftPanelScrollRef.current?.scrollTop ?? null,
      null, // Journal doesn't have a right panel
      storageKey
    );
    
    // Restore new tab's scroll position
    setActiveTab(newTab);
    
    // Restore scroll after a brief delay to ensure DOM is updated
    setTimeout(() => {
      const newTabContent = tabContentRefs.current.get(newTab);
      if (newTabContent) {
        // Get saved position from in-memory map first, then from storage
        let savedPosition = tabScrollPositions.current.get(newTab) || 0;
        if (savedPosition === 0 && selectedEntry?.id) {
          // Try to get from storage if not in memory
          const storageKey = `journal_entry_${selectedEntry.id}`;
          const scrollState = restoreAllScrollPositions(storageKey);
          savedPosition = scrollState.tabPositions.get(newTab) || 0;
          // Update in-memory map
          if (savedPosition > 0) {
            tabScrollPositions.current.set(newTab, savedPosition);
          }
        }
        if (savedPosition > 0) {
          newTabContent.scrollTop = savedPosition;
        }
      }
    }, 100);
  };

  // Save state before component unmounts
  useEffect(() => {
    const handleBeforeUnload = () => {
      saveWorkInProgress();
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    // Also save periodically
    const interval = setInterval(() => {
      saveWorkInProgress();
    }, 5000); // Save every 5 seconds
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      clearInterval(interval);
      saveWorkInProgress(); // Save one last time
    };
  }, [entryFormData, tradesFormData, checklistResponses, entryLevelChecklistResponses, checklistTradeAssociations, activeTradeIndex, activeTab, isCreating, isEditing, selectedEntry]);

  useEffect(() => {
    loadEntries();
    loadStrategies();
    loadAvailableSymbols();
    
    // Restore selected entry if we have a saved ID (skip when opened from Emotions via state)
    const openFromState = (location.state as { openEntryId?: number } | null)?.openEntryId != null;
    if (!openFromState) {
      const savedEntryId = localStorage.getItem('journal_selected_entry_id');
      if (savedEntryId) {
        const entryId = parseInt(savedEntryId, 10);
        if (!isNaN(entryId)) {
          setTimeout(() => loadEntry(entryId), 300);
        }
      }
    }
    
    // Restore work in progress after loading (only if we have saved state)
    const hasWorkInProgress = localStorage.getItem('journal_work_in_progress');
    if (hasWorkInProgress) {
      setTimeout(() => {
        restoreWorkInProgress();
      }, 200);
    }
  }, []);

  // Open specific entry/trade when navigated from Emotions (e.g. "Open in Journal")
  useEffect(() => {
    const state = location.state as { openEntryId?: number; openTradeId?: number } | null;
    if (state?.openEntryId != null) {
      loadEntry(state.openEntryId, { openTradeId: state.openTradeId });
      navigate(location.pathname, { replace: true }); // clear state so back button doesn't re-open
    }
  }, [location.state]);

  useEffect(() => {
    if (entryFormData.strategy_id) {
      loadStrategyChecklists(entryFormData.strategy_id);
    } else {
      setStrategyChecklists(new Map());
      setChecklistResponses(new Map());
    }
  }, [entryFormData.strategy_id]);

  useEffect(() => {
    if (selectedEntry && !isCreating && !isEditing) {
      loadTrades(selectedEntry.id);
      loadLinkedPairs(selectedEntry.id);
      if (selectedEntry.strategy_id) {
        loadChecklistResponses(selectedEntry.id, selectedEntry.strategy_id);
      }
      
      // Restore scroll positions after entry data is loaded (entry-specific)
      if (selectedEntry?.id) {
        setTimeout(() => {
          const storageKey = `journal_entry_${selectedEntry.id}`;
          const scrollState = restoreAllScrollPositions(storageKey);
          // Restore tab scroll positions to the ref
          scrollState.tabPositions.forEach((pos, tab) => {
            tabScrollPositions.current.set(tab, pos);
          });
          // Restore left panel scroll
          if (leftPanelScrollRef.current && scrollState.leftPanelScroll !== null) {
            requestAnimationFrame(() => {
              if (leftPanelScrollRef.current) {
                leftPanelScrollRef.current.scrollTop = scrollState.leftPanelScroll!;
              }
            });
          }
          // Restore active tab scroll
          const tabContent = tabContentRefs.current.get(activeTab);
          if (tabContent) {
            const savedPosition = tabScrollPositions.current.get(activeTab) || 0;
            if (savedPosition > 0) {
              requestAnimationFrame(() => {
                tabContent.scrollTop = savedPosition;
              });
            }
          }
        }, 300);
      }
    }
  }, [selectedEntry, isCreating, isEditing, activeTab]);

  // Load actual trades when "Link to actual trades" modal opens
  useEffect(() => {
    if (linkActualTradesModalJournalTradeId == null) return;
    let cancelled = false;
    (async () => {
      try {
        const trades = await invoke<ActualTrade[]>("get_trades");
        if (!cancelled) setActualTrades(trades);
      } catch (e) {
        if (!cancelled) setActualTrades([]);
      }
    })();
    return () => { cancelled = true; };
  }, [linkActualTradesModalJournalTradeId]);

  // Load emotional states linked to this journal entry/implementation when on Emotional State or Links tab
  useEffect(() => {
    if ((activeTab !== "emotional_state" && activeTab !== "links") || !selectedEntry?.id) {
      setJournalEmotionalStates([]);
      return;
    }
    const jtId = tradesFormData[activeTradeIndex]?.id ?? null;
    let cancelled = false;
    (async () => {
      try {
        const states = await invoke<JournalEmotionalState[]>("get_emotional_states_for_journal", {
          journalEntryId: selectedEntry.id,
          journalTradeId: jtId ?? undefined,
        });
        if (!cancelled) {
          setJournalEmotionalStates(states);
          const groups = groupEmotionalStatesByTimestamp(states);
          const ids = groups.map((g) => g[0].id);
          const scopes: Record<number, { scope: "entry" | "trades"; tradeIndex: number | null }> = {};
          for (const g of groups) {
            const first = g[0];
            const jtId = first.journal_trade_id ?? null;
            if (jtId == null) {
              scopes[first.id] = { scope: "entry", tradeIndex: null };
            } else {
              const idx = tradesFormData.findIndex((t) => t.id === jtId);
              scopes[first.id] = { scope: "trades", tradeIndex: idx >= 0 ? idx : null };
            }
          }
          setEntryFormData((prev) => ({ ...prev, linked_emotional_state_ids: ids, linked_emotional_state_link_scopes: scopes }));
        }
      } catch {
        if (!cancelled) {
          setJournalEmotionalStates([]);
          setEntryFormData((prev) => ({ ...prev, linked_emotional_state_ids: [], linked_emotional_state_link_scopes: {} }));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab, selectedEntry?.id, activeTradeIndex, tradesFormData]);

  // Load emotional states for view mode (when viewing an entry, not editing)
  useEffect(() => {
    if (!selectedEntry?.id || isCreating || isEditing) {
      setViewEntryEmotionalStates([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const states = await invoke<JournalEmotionalState[]>("get_emotional_states_for_journal", {
          journalEntryId: selectedEntry.id,
        });
        if (!cancelled) setViewEntryEmotionalStates(states);
      } catch {
        if (!cancelled) setViewEntryEmotionalStates([]);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedEntry?.id, isCreating, isEditing]);

  // Load all emotional states and real trades for "Link to" dropdowns when on Emotional State tab
  useEffect(() => {
    if (activeTab !== "emotional_state" && activeTab !== "links") return;
    (async () => {
      try {
        const [states, trades] = await Promise.all([
          invoke<JournalEmotionalState[]>("get_emotional_states"),
          invoke<{ id: number; symbol: string; side: string; timestamp: string; quantity: number; price: number }[]>("get_trades"),
        ]);
        setAllEmotionalStates(states);
        let pnlMap: Record<number, number> = {};
        try {
          const withPairing = await invoke<{ trade: { id: number }; entry_pairs: { net_profit_loss: number }[]; exit_pairs: { net_profit_loss: number }[] }[]>("get_trades_with_pairing", { pairing_method: null, start_date: null, end_date: null });
          for (const row of withPairing) {
            const id = row.trade?.id;
            if (id == null) continue;
            const entrySum = (row.entry_pairs || []).reduce((s, p) => s + (p?.net_profit_loss ?? 0), 0);
            const exitSum = (row.exit_pairs || []).reduce((s, p) => s + (p?.net_profit_loss ?? 0), 0);
            pnlMap[id] = (pnlMap[id] ?? 0) + entrySum + exitSum;
          }
        } catch {
          /* optional */
        }
        setRealTradesForLink(trades.map((t) => ({
          id: t.id,
          symbol: t.symbol,
          side: t.side,
          timestamp: t.timestamp,
          quantity: t.quantity ?? 0,
          pnl: pnlMap[t.id] !== undefined && pnlMap[t.id] !== 0 ? pnlMap[t.id] : undefined,
        })));
      } catch {
        setAllEmotionalStates([]);
        setRealTradesForLink([]);
      }
    })();
  }, [activeTab, selectedEntry?.id]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (journalLinksStateDropdownRef.current && !journalLinksStateDropdownRef.current.contains(e.target as Node)) setJournalLinksStateDropdownOpen(false);
      if (journalLinksTradeDropdownRef.current && !journalLinksTradeDropdownRef.current.contains(e.target as Node)) setJournalLinksTradeDropdownOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const loadEntries = async () => {
    try {
      const data = await invoke<JournalEntry[]>("get_journal_entries");
      setEntries(data);
    } catch (error) {
      console.error("Error loading journal entries:", error);
    } finally {
      setLoading(false);
    }
  };

  const sortedJournalEntries = useMemo(() => {
    const copy = [...entries];
    copy.sort((a, b) => {
      const dA = parse(a.date, "yyyy-MM-dd", new Date()).getTime();
      const dB = parse(b.date, "yyyy-MM-dd", new Date()).getTime();
      return journalEntriesSort === "newest" ? dB - dA : dA - dB;
    });
    return copy;
  }, [entries, journalEntriesSort]);

  const journalEntriesTotalPages = Math.max(1, Math.ceil(sortedJournalEntries.length / JOURNAL_ENTRIES_PAGE_SIZE));
  const effectiveJournalPage = Math.min(journalEntriesPage, journalEntriesTotalPages);
  const paginatedJournalEntries = useMemo(
    () =>
      sortedJournalEntries.slice(
        (effectiveJournalPage - 1) * JOURNAL_ENTRIES_PAGE_SIZE,
        effectiveJournalPage * JOURNAL_ENTRIES_PAGE_SIZE
      ),
    [sortedJournalEntries, effectiveJournalPage]
  );

  const loadStrategies = async () => {
    try {
      const data = await invoke<Strategy[]>("get_strategies");
      setStrategies(data);
    } catch (error) {
      console.error("Error loading strategies:", error);
    }
  };

  const loadAvailableSymbols = async () => {
    try {
      const symbols = await invoke<string[]>("get_all_symbols");
      setAvailableSymbols(symbols);
    } catch (error) {
      console.error("Error loading symbols:", error);
    }
  };

  const loadTrades = async (entryId: number): Promise<JournalTrade[]> => {
    try {
      const trades = await invoke<JournalTrade[]>("get_journal_trades", { journalEntryId: entryId });
      setSelectedTrades(trades);
      return trades;
    } catch (error) {
      console.error("Error loading trades:", error);
      return [];
    }
  };

  const loadLinkedPairs = async (entryId: number) => {
    try {
      const pairs = await invoke<PairedTrade[]>("get_journal_entry_pairs", { journalEntryId: entryId });
      setLinkedPairs(pairs);
    } catch (error) {
      console.error("Error loading linked pairs:", error);
      setLinkedPairs([]);
    }
  };

  const loadStrategyChecklists = async (strategyId: number) => {
    try {
      const allItems = await invoke<ChecklistItem[]>("get_strategy_checklist", {
        strategyId: strategyId,
        checklistType: null,
      });

      // Group by checklist_type
      const grouped = new Map<string, ChecklistItem[]>();
      for (const item of allItems) {
        const checklistType = item.checklist_type || "entry";
        if (!grouped.has(checklistType)) {
          grouped.set(checklistType, []);
        }
        grouped.get(checklistType)!.push(item);
      }

      // Sort each group by item_order
      for (const [, items] of grouped.entries()) {
        items.sort((a, b) => a.item_order - b.item_order);
      }

      setStrategyChecklists(new Map([[strategyId, grouped]]));
      // Reset checklist responses for all trades and entry-level
      const newResponses = new Map<number, Map<number, boolean>>();
      tradesFormData.forEach((_, index) => {
        newResponses.set(index, new Map());
      });
      setChecklistResponses(newResponses);
      setEntryLevelChecklistResponses(new Map());
      setChecklistTradeAssociations(new Map());
    } catch (error) {
      console.error("Error loading strategy checklists:", error);
    }
  };

  const loadChecklistResponses = async (entryId: number, strategyId: number) => {
    try {
      const [responses, allChecklistItems] = await Promise.all([
        invoke<JournalChecklistResponse[]>("get_journal_checklist_responses", { journalEntryId: entryId }),
        invoke<ChecklistItem[]>("get_strategy_checklist", { strategyId, checklistType: null }),
      ]);

      const itemIdToType = new Map<number, string>();
      for (const item of allChecklistItems) {
        itemIdToType.set(item.id, item.checklist_type || "entry");
      }

      const entryLevelChecked = new Map<number, boolean>();
      const entryLevelTradeAssociations = new Map<number, number[] | null>();
      const perTradeResponseMap = new Map<number, boolean>();

      for (const response of responses) {
        const itemType = itemIdToType.get(response.checklist_item_id);
        if (ENTRY_LEVEL_CHECKLIST_TYPES.includes(itemType || "")) {
          entryLevelChecked.set(response.checklist_item_id, response.is_checked);
          if (response.journal_trade_ids) {
            try {
              const ids = JSON.parse(response.journal_trade_ids) as number[];
              entryLevelTradeAssociations.set(response.checklist_item_id, ids.length > 0 ? ids : null);
            } catch {
              entryLevelTradeAssociations.set(response.checklist_item_id, null);
            }
          } else {
            entryLevelTradeAssociations.set(response.checklist_item_id, null);
          }
        } else {
          perTradeResponseMap.set(response.checklist_item_id, response.is_checked);
        }
      }

      setEntryLevelChecklistResponses(entryLevelChecked);
      setChecklistTradeAssociations(entryLevelTradeAssociations);

      const newResponses = new Map<number, Map<number, boolean>>();
      selectedTrades.forEach((_, index) => {
        newResponses.set(index, new Map(perTradeResponseMap));
      });
      setChecklistResponses(newResponses);
    } catch (error) {
      console.error("Error loading checklist responses:", error);
    }
  };

  const handleCreateNew = () => {
    clearWorkInProgress(); // Clear any old work in progress
    setIsCreating(true);
    setIsEditing(false);
    setSelectedEntry(null);
    localStorage.removeItem('journal_selected_entry_id');
    setSelectedTrades([]);
    setJournalTradeActualTradeIds(new Map());
    setLinkActualTradesModalJournalTradeId(null);
    setPendingEmotionalStates([]);
    setEntryFormData({
      date: format(new Date(), "yyyy-MM-dd"),
      title: "",
      strategy_id: null,
      linked_trade_ids: [],
      linked_emotional_state_ids: [],
      linked_emotional_state_link_scopes: {},
    });
    setTradesFormData([{
      id: null,
      symbol: "",
      position: "",
      timeframe: "",
      entry_type: "",
      exit_type: "",
      trade: "",
      what_went_well: "",
      what_could_be_improved: "",
      emotional_state: "",
      notes: "",
      outcome: "None",
      trade_order: 0,
    }]);
    setActiveTradeIndex(0);
    setActiveTab("trade");
    setChecklistResponses(new Map());
    setEntryLevelChecklistResponses(new Map());
    setChecklistTradeAssociations(new Map());
    setLinkedPairs([]);
    tabScrollPositions.current.clear();
  };

  const handleEdit = async () => {
    if (selectedEntry) {
      setIsEditing(true);
      setIsCreating(false);
      setPendingEmotionalStates([]);
      let linkedTradeIds: number[] = [];
      if (selectedEntry.linked_trade_ids) {
        try {
          const parsed = JSON.parse(selectedEntry.linked_trade_ids) as number[];
          if (Array.isArray(parsed)) linkedTradeIds = parsed;
        } catch {
          /* ignore */
        }
      }
      setEntryFormData({
        date: selectedEntry.date,
        title: selectedEntry.title,
        strategy_id: selectedEntry.strategy_id,
        linked_trade_ids: linkedTradeIds,
        linked_emotional_state_ids: [], // synced when Links/Emotional State tab loads journalEmotionalStates
        linked_emotional_state_link_scopes: {},
      });
      const loadedTrades = await loadTrades(selectedEntry.id);
      await loadTrades(selectedEntry.id);
      await loadLinkedPairs(selectedEntry.id);
      if (selectedEntry.strategy_id) {
        await loadStrategyChecklists(selectedEntry.strategy_id);
        await loadChecklistResponses(selectedEntry.id, selectedEntry.strategy_id);
      }
      
      // Convert trades to form data (use loadedTrades, not selectedTrades - state updates are async)
      const tradesData: Array<{
        id: number | null;
        symbol: string;
        position: string;
        timeframe: string;
        entry_type: string;
        exit_type: string;
        trade: string;
        what_went_well: string;
        what_could_be_improved: string;
        emotional_state: string;
        notes: string;
        outcome: string;
        trade_order: number;
      }> = loadedTrades.map(trade => ({
        id: trade.id,
        symbol: trade.symbol || "",
        position: trade.position || "",
        timeframe: trade.timeframe || "",
        entry_type: trade.entry_type || "",
        exit_type: trade.exit_type || "",
        trade: trade.trade || "",
        what_went_well: trade.what_went_well || "",
        what_could_be_improved: trade.what_could_be_improved || "",
        emotional_state: trade.emotional_state || "",
        notes: trade.notes || "",
        outcome: trade.outcome || "None",
        trade_order: trade.trade_order ?? 0,
      }));
      
      if (tradesData.length === 0) {
        tradesData.push({
          id: null,
          symbol: "",
          position: "",
          timeframe: "",
          entry_type: "",
          exit_type: "",
          trade: "",
          what_went_well: "",
          what_could_be_improved: "",
          emotional_state: "",
          notes: "",
          outcome: "None",
          trade_order: 0,
        });
      }
      
      setTradesFormData(tradesData);
      setActiveTradeIndex(0);
      setActiveTab("trade");

      // Load journal trade -> actual trade associations for each journal trade
      const assocMap = new Map<number, number[]>();
      for (const jt of loadedTrades) {
        if (jt.id != null) {
          try {
            const ids = await invoke<number[]>("get_journal_trade_actual_trade_ids", { journalTradeId: jt.id });
            assocMap.set(jt.id, ids);
          } catch {
            assocMap.set(jt.id, []);
          }
        }
      }
      setJournalTradeActualTradeIds(assocMap);
      
      // Store initial state for undo
      const initialState = {
        entry: {
          date: selectedEntry.date,
          title: selectedEntry.title,
          strategy_id: selectedEntry.strategy_id,
        },
        trades: tradesData.map(t => ({ ...t })),
        checklistResponses: new Map(checklistResponses),
      };
      setOriginalEntryData(initialState);
      setEditHistory([initialState]);
    }
  };

  const handleDeleteClick = () => {
    if (selectedEntry) {
      setShowDeleteConfirmModal(true);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!selectedEntry) return;
    
    try {
      await invoke("delete_journal_entry", { id: selectedEntry.id });
      await loadEntries();
      setSelectedEntry(null);
    localStorage.removeItem('journal_selected_entry_id');
      setSelectedTrades([]);
      setShowDeleteConfirmModal(false);
    } catch (error) {
      console.error("Error deleting entry:", error);
      alert("Failed to delete entry: " + error);
      setShowDeleteConfirmModal(false);
    }
  };

  const handleDeleteCancel = () => {
    setShowDeleteConfirmModal(false);
  };

  const handleEmotionalStateDeleteCancel = () => {
    setEmotionalStateDeleteTarget(null);
  };

  const handleEmotionalStateDeleteConfirm = async () => {
    if (!emotionalStateDeleteTarget) return;
    if (emotionalStateDeleteTarget.type === "saved") {
      try {
        for (const state of emotionalStateDeleteTarget.states) {
          await invoke("delete_emotional_state", { id: state.id });
        }
        const jtId = tradesFormData[activeTradeIndex]?.id ?? null;
        if (selectedEntry?.id != null) {
          const states = await invoke<JournalEmotionalState[]>("get_emotional_states_for_journal", {
            journalEntryId: selectedEntry.id,
            journalTradeId: jtId ?? undefined,
          });
          setJournalEmotionalStates(states);
        }
      } catch (e) {
        console.error(e);
      }
    } else {
      const { tradeIndex, idx } = emotionalStateDeleteTarget;
      const forThisTrade = pendingEmotionalStates.filter((p) => p.tradeIndex === tradeIndex);
      const kept = forThisTrade.filter((_, i) => i !== idx);
      setPendingEmotionalStates((prev) => [...prev.filter((p) => p.tradeIndex !== tradeIndex), ...kept]);
    }
    setEmotionalStateDeleteTarget(null);
  };

  const handleAddTrade = () => {
    const newTrade = {
      id: null,
      symbol: "",
      position: "",
      timeframe: "",
      entry_type: "",
      exit_type: "",
      trade: "",
      what_went_well: "",
      what_could_be_improved: "",
      emotional_state: "",
      notes: "",
      outcome: "None",
      trade_order: tradesFormData.length,
    };
    setTradesFormData([...tradesFormData, newTrade]);
    setActiveTradeIndex(tradesFormData.length);
    
    // Initialize checklist responses for new trade
    const newResponses = new Map(checklistResponses);
    newResponses.set(tradesFormData.length, new Map());
    setChecklistResponses(newResponses);
  };

  const handleRemoveTrade = (index: number) => {
    if (tradesFormData.length <= 1) {
      alert("You must have at least one trade");
      return;
    }
    
    const newTrades = tradesFormData.filter((_, i) => i !== index);
    // Reorder trades
    const reorderedTrades = newTrades.map((trade, i) => ({ ...trade, trade_order: i }));
    setTradesFormData(reorderedTrades);
    
    if (activeTradeIndex >= reorderedTrades.length) {
      setActiveTradeIndex(reorderedTrades.length - 1);
    }
    
    // Remove checklist responses for removed trade
    const newResponses = new Map(checklistResponses);
    newResponses.delete(index);
    // Reindex remaining responses
    const reindexedResponses = new Map<number, Map<number, boolean>>();
    reorderedTrades.forEach((_, newIndex) => {
      const oldIndex = newIndex >= index ? newIndex + 1 : newIndex;
      reindexedResponses.set(newIndex, newResponses.get(oldIndex) || new Map());
    });
    setChecklistResponses(reindexedResponses);
    
    // Track history for undo
    if (isEditing) {
      const currentState = {
        entry: { ...entryFormData },
        trades: reorderedTrades.map(t => ({ ...t })),
        checklistResponses: new Map(reindexedResponses),
      };
      setEditHistory(prev => [...prev, currentState].slice(-10));
    }
  };

  // Auto-save function (silent, doesn't require title)
  const autoSave = async () => {
    // Only auto-save if we have a title and are creating or editing
    if (!entryFormData.title.trim() || (!isCreating && !isEditing)) {
      return;
    }

    try {
      let entryId: number;
      let toAdd: number[] = [];

      if (isCreating) {
        entryId = await invoke<number>("create_journal_entry", {
          date: entryFormData.date,
          title: entryFormData.title,
          strategyId: entryFormData.strategy_id,
        });
        // Persist linked trades on the new entry
        await invoke("update_journal_entry", {
          id: entryId,
          date: entryFormData.date,
          title: entryFormData.title,
          strategyId: entryFormData.strategy_id,
          linked_trade_ids: (entryFormData.linked_trade_ids?.length ?? 0) > 0 ? JSON.stringify(entryFormData.linked_trade_ids) : null,
        });
        // Link to emotional state entries (chosen while creating) — scope applied after trades below
        // After first auto-save, switch from creating to editing
        setIsCreating(false);
        setIsEditing(true);
        const savedEntry = await invoke<JournalEntry>("get_journal_entry", { id: entryId });
        setSelectedEntry(savedEntry);
      } else if (selectedEntry) {
        entryId = selectedEntry.id;
        await invoke("update_journal_entry", {
          id: selectedEntry.id,
          date: entryFormData.date,
          title: entryFormData.title,
          strategyId: entryFormData.strategy_id,
          linked_trade_ids: (entryFormData.linked_trade_ids?.length ?? 0) > 0 ? JSON.stringify(entryFormData.linked_trade_ids) : null,
        });
        // Sync emotional state links
        const formStateIds = entryFormData.linked_emotional_state_ids ?? [];
        const currentGroupIds = groupEmotionalStatesByTimestamp(journalEmotionalStates).map((g) => g[0].id);
        const toRemove = currentGroupIds.filter((id) => !formStateIds.includes(id));
        toAdd = formStateIds.filter((id) => !currentGroupIds.includes(id));
        if (toRemove.length > 0) await invoke("remove_journal_entry_from_emotional_states", { journalEntryId: entryId, emotionalStateIds: toRemove });
        if (toAdd.length > 0) await invoke("add_journal_entry_to_emotional_states", { journalEntryId: entryId, emotionalStateIds: toAdd });
      } else {
        return;
      }

      // Save all trades and collect trade IDs for checklist associations
      const tradeIdsInOrder: number[] = [];
      for (let i = 0; i < tradesFormData.length; i++) {
        const tradeData = tradesFormData[i];
        if (tradeData.id) {
          tradeIdsInOrder.push(tradeData.id);
          await invoke("update_journal_trade", {
            id: tradeData.id,
            symbol: tradeData.symbol || null,
            position: tradeData.position || null,
            timeframe: tradeData.timeframe || null,
            entryType: tradeData.entry_type || null,
            exitType: tradeData.exit_type || null,
            trade: tradeData.trade || null,
            whatWentWell: tradeData.what_went_well || null,
            whatCouldBeImproved: tradeData.what_could_be_improved || null,
            emotionalState: tradeData.emotional_state || null,
            notes: tradeData.notes || null,
            outcome: tradeData.outcome || null,
            tradeOrder: i,
          });
        } else {
          const newTradeId = await invoke<number>("create_journal_trade", {
            journalEntryId: entryId,
            symbol: tradeData.symbol || null,
            position: tradeData.position || null,
            timeframe: tradeData.timeframe || null,
            entryType: tradeData.entry_type || null,
            exitType: tradeData.exit_type || null,
            trade: tradeData.trade || null,
            whatWentWell: tradeData.what_went_well || null,
            whatCouldBeImproved: tradeData.what_could_be_improved || null,
            emotionalState: tradeData.emotional_state || null,
            notes: tradeData.notes || null,
            outcome: tradeData.outcome || null,
            tradeOrder: i,
          });
          tradeIdsInOrder.push(newTradeId);
        }
      }

      // Save checklist responses
      if (entryFormData.strategy_id) {
        const checklists = strategyChecklists.get(entryFormData.strategy_id);
        if (checklists) {
          const responses: [number, boolean, string | null][] = [];
          const firstTradeResponses = checklistResponses.get(0) || new Map();
          for (const [, items] of checklists.entries()) {
            for (const item of items) {
              const isEntryLevel = ENTRY_LEVEL_CHECKLIST_TYPES.includes(item.checklist_type || "");
              let isChecked: boolean;
              let journalTradeIds: string | null = null;
              if (isEntryLevel) {
                isChecked = entryLevelChecklistResponses.get(item.id) || false;
                const assoc = checklistTradeAssociations.get(item.id);
                if (assoc && assoc.length > 0) {
                  const ids = assoc.every(n => n >= 0 && n < tradeIdsInOrder.length)
                    ? assoc.map(idx => tradeIdsInOrder[idx]).filter(Boolean)
                    : assoc.filter(id => tradeIdsInOrder.includes(id));
                  if (ids.length > 0) journalTradeIds = JSON.stringify(ids);
                }
              } else {
                isChecked = firstTradeResponses.get(item.id) || false;
              }
              responses.push([item.id, isChecked, journalTradeIds]);
            }
          }
          await invoke("save_journal_checklist_responses", {
            journalEntryId: entryId,
            responses: responses,
          });
        }
      }

      // Link emotional states with scope (after trades so we have trade IDs)
      const stateIdsToLinkAfterTrades = isCreating ? (entryFormData.linked_emotional_state_ids ?? []) : toAdd;
      if (stateIdsToLinkAfterTrades.length > 0) {
        if (isCreating) {
          await invoke("add_journal_entry_to_emotional_states", { journalEntryId: entryId, emotionalStateIds: stateIdsToLinkAfterTrades });
        }
        for (const stateId of stateIdsToLinkAfterTrades) {
          const scope = entryFormData.linked_emotional_state_link_scopes?.[stateId];
          const jtId = scope?.scope === "trades" && scope.tradeIndex != null ? (tradeIdsInOrder[scope.tradeIndex] ?? null) : null;
          await invoke("link_emotional_states_to_journal", {
            emotionalStateIds: [stateId],
            journalEntryId: entryId,
            journalTradeId: jtId ?? undefined,
          });
        }
      }

      // Reload trades to get updated IDs
      await loadTrades(entryId);
      await loadLinkedPairs(entryId);
    } catch (error) {
      // Silently fail for auto-save
      console.error("Auto-save error:", error);
    }
  };

  // Restore scroll position when tab becomes active
  useEffect(() => {
    if (!selectedEntry?.id) return; // Only restore if we have an entry selected
    
    const tabContent = tabContentRefs.current.get(activeTab);
    if (tabContent) {
      // First try in-memory map, then check storage
      let savedPosition = tabScrollPositions.current.get(activeTab) || 0;
      if (savedPosition === 0) {
        // Try to get from storage
        const storageKey = `journal_entry_${selectedEntry.id}`;
        const scrollState = restoreAllScrollPositions(storageKey);
        savedPosition = scrollState.tabPositions.get(activeTab) || 0;
        // Update in-memory map
        if (savedPosition > 0) {
          tabScrollPositions.current.set(activeTab, savedPosition);
        }
      }
      // Use requestAnimationFrame to ensure DOM is ready
      if (savedPosition > 0) {
        requestAnimationFrame(() => {
          const tabContent = tabContentRefs.current.get(activeTab);
          if (tabContent) {
            tabContent.scrollTop = savedPosition;
          }
        });
      }
    } else {
      // Tab content not ready yet, retry after a delay
      setTimeout(() => {
        const tabContent = tabContentRefs.current.get(activeTab);
        if (tabContent && selectedEntry?.id) {
          const storageKey = `journal_entry_${selectedEntry.id}`;
          const scrollState = restoreAllScrollPositions(storageKey);
          const savedPosition = scrollState.tabPositions.get(activeTab) || tabScrollPositions.current.get(activeTab) || 0;
          if (savedPosition > 0) {
            requestAnimationFrame(() => {
              if (tabContent) {
                tabContent.scrollTop = savedPosition;
              }
            });
          }
        }
      }, 100);
    }
  }, [activeTab, selectedEntry?.id]);

  // Restore scroll positions on mount (only if we have a selected entry)
  useEffect(() => {
    if (selectedEntry?.id) {
      const storageKey = `journal_entry_${selectedEntry.id}`;
      const scrollState = restoreAllScrollPositions(storageKey);
      // Restore tab scroll positions
      scrollState.tabPositions.forEach((pos, tab) => {
        tabScrollPositions.current.set(tab, pos);
      });
      
      // Restore left panel scroll after a delay to ensure DOM is ready
      setTimeout(() => {
        if (leftPanelScrollRef.current && scrollState.leftPanelScroll !== null) {
          requestAnimationFrame(() => {
            if (leftPanelScrollRef.current) {
              leftPanelScrollRef.current.scrollTop = scrollState.leftPanelScroll!;
            }
          });
        }
        
        // Restore active tab scroll
        const tabContent = tabContentRefs.current.get(activeTab);
        if (tabContent) {
          const savedPosition = tabScrollPositions.current.get(activeTab) || 0;
          if (savedPosition > 0) {
            requestAnimationFrame(() => {
              tabContent.scrollTop = savedPosition;
            });
          }
        }
      }, 100);
    }
  }, [selectedEntry?.id, activeTab]);

  // Save left panel scroll position on scroll
  useEffect(() => {
    const leftPanel = leftPanelScrollRef.current;
    if (leftPanel) {
      const handleScroll = () => {
        if (leftPanelScrollRef.current) {
          const storageKey = selectedEntry?.id ? `journal_entry_${selectedEntry.id}` : "journal";
          saveAllScrollPositions(
            tabScrollPositions.current,
            leftPanelScrollRef.current.scrollTop,
            null,
            storageKey
          );
        }
      };
      leftPanel.addEventListener('scroll', handleScroll, { passive: true });
      return () => {
        leftPanel.removeEventListener('scroll', handleScroll);
      };
    }
  }, []);

  // Debounced auto-save when form data changes
  useEffect(() => {
    if (!isCreating && !isEditing) return;
    if (!entryFormData.title.trim()) return;

    const timeoutId = setTimeout(() => {
      autoSave();
    }, 2000); // 2 second debounce

    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryFormData.title, entryFormData.date, entryFormData.strategy_id, tradesFormData.length]);

  const handleSave = async () => {
    if (!entryFormData.title.trim()) {
      setShowTitleRequiredModal(true);
      return;
    }
    // Prevent saving a bloated trade list (e.g. from stale work-in-progress)
    const MAX_TRADES_PER_ENTRY = 100;
    if (tradesFormData.length > MAX_TRADES_PER_ENTRY) {
      alert(`This entry has ${tradesFormData.length} trades (max ${MAX_TRADES_PER_ENTRY}). Reload the entry from the list to fix, or remove extra trades before saving.`);
      return;
    }

    try {
      let entryId: number;
      let toAdd: number[] = [];

      if (isCreating) {
        entryId = await invoke<number>("create_journal_entry", {
          date: entryFormData.date,
          title: entryFormData.title,
          strategyId: entryFormData.strategy_id,
        });
        // Persist linked trades (and metadata) on the new entry
        await invoke("update_journal_entry", {
          id: entryId,
          date: entryFormData.date,
          title: entryFormData.title,
          strategyId: entryFormData.strategy_id,
          linked_trade_ids: (entryFormData.linked_trade_ids?.length ?? 0) > 0 ? JSON.stringify(entryFormData.linked_trade_ids) : null,
        });
      } else if (selectedEntry) {
        entryId = selectedEntry.id;
        await invoke("update_journal_entry", {
          id: selectedEntry.id,
          date: entryFormData.date,
          title: entryFormData.title,
          strategyId: entryFormData.strategy_id,
          linked_trade_ids: (entryFormData.linked_trade_ids?.length ?? 0) > 0 ? JSON.stringify(entryFormData.linked_trade_ids) : null,
        });
        // Sync emotional state links (add new, remove unchecked)
        const formStateIds = entryFormData.linked_emotional_state_ids ?? [];
        const currentGroupIds = groupEmotionalStatesByTimestamp(journalEmotionalStates).map((g) => g[0].id);
        const toRemove = currentGroupIds.filter((id) => !formStateIds.includes(id));
        toAdd = formStateIds.filter((id) => !currentGroupIds.includes(id));
        if (toRemove.length > 0) await invoke("remove_journal_entry_from_emotional_states", { journalEntryId: entryId, emotionalStateIds: toRemove });
        if (toAdd.length > 0) await invoke("add_journal_entry_to_emotional_states", { journalEntryId: entryId, emotionalStateIds: toAdd });
        
        // Get IDs of trades that should be kept
        const keptTradeIds = new Set(tradesFormData.filter(t => t.id !== null).map(t => t.id!));
        
        // Delete trades that are no longer in the form
        for (const trade of selectedTrades) {
          if (trade.id && !keptTradeIds.has(trade.id)) {
            await invoke("delete_journal_trade", { id: trade.id });
          }
        }
      } else {
        return;
      }

      // Save all trades and collect trade IDs for checklist associations
      const tradeIdsInOrder: number[] = [];
      for (let i = 0; i < tradesFormData.length; i++) {
        const tradeData = tradesFormData[i];
        if (tradeData.id) {
          tradeIdsInOrder.push(tradeData.id);
          await invoke("update_journal_trade", {
            id: tradeData.id,
            symbol: tradeData.symbol || null,
            position: tradeData.position || null,
            timeframe: tradeData.timeframe || null,
            entryType: tradeData.entry_type || null,
            exitType: tradeData.exit_type || null,
            trade: tradeData.trade || null,
            whatWentWell: tradeData.what_went_well || null,
            whatCouldBeImproved: tradeData.what_could_be_improved || null,
            emotionalState: tradeData.emotional_state || null,
            notes: tradeData.notes || null,
            outcome: tradeData.outcome || null,
            tradeOrder: i,
          });
        } else {
          const newTradeId = await invoke<number>("create_journal_trade", {
            journalEntryId: entryId,
            symbol: tradeData.symbol || null,
            position: tradeData.position || null,
            timeframe: tradeData.timeframe || null,
            entryType: tradeData.entry_type || null,
            exitType: tradeData.exit_type || null,
            trade: tradeData.trade || null,
            whatWentWell: tradeData.what_went_well || null,
            whatCouldBeImproved: tradeData.what_could_be_improved || null,
            emotionalState: tradeData.emotional_state || null,
            notes: tradeData.notes || null,
            outcome: tradeData.outcome || null,
            tradeOrder: i,
          });
          tradeIdsInOrder.push(newTradeId);
        }
      }

      // Save checklist responses
      if (entryFormData.strategy_id) {
        const checklists = strategyChecklists.get(entryFormData.strategy_id);
        if (checklists) {
          const responses: [number, boolean, string | null][] = [];
          const firstTradeResponses = checklistResponses.get(0) || new Map();
          for (const [, items] of checklists.entries()) {
            for (const item of items) {
              const isEntryLevel = ENTRY_LEVEL_CHECKLIST_TYPES.includes(item.checklist_type || "");
              let isChecked: boolean;
              let journalTradeIds: string | null = null;
              if (isEntryLevel) {
                isChecked = entryLevelChecklistResponses.get(item.id) || false;
                const assoc = checklistTradeAssociations.get(item.id);
                if (assoc && assoc.length > 0) {
                  const ids = assoc.every(n => n >= 0 && n < tradeIdsInOrder.length)
                    ? assoc.map(idx => tradeIdsInOrder[idx]).filter(Boolean)
                    : assoc.filter(id => tradeIdsInOrder.includes(id));
                  if (ids.length > 0) journalTradeIds = JSON.stringify(ids);
                }
              } else {
                isChecked = firstTradeResponses.get(item.id) || false;
              }
              responses.push([item.id, isChecked, journalTradeIds]);
            }
          }
          await invoke("save_journal_checklist_responses", {
            journalEntryId: entryId,
            responses: responses,
          });
        }
      }

      // Persist emotional states: pending list + any form-in-progress (one state per trade or one for entire entry)
      const toPersist: Array<{ tradeIndex: number; selectedEmotions: Record<string, number>; notes: string }> = [...pendingEmotionalStates];
      const hasFormContent = Object.keys(newEmotionalStateForm.selectedEmotions).length > 0 || (newEmotionalStateForm.notes || "").trim() !== "";
      if (showAddEmotionalStateForm && hasFormContent) {
        if (newEmotionalStateLinkScope === "entry") {
          toPersist.push({ tradeIndex: -1, selectedEmotions: newEmotionalStateForm.selectedEmotions, notes: newEmotionalStateForm.notes });
        } else {
          for (const i of newEmotionalStateTradeIndices) {
            toPersist.push({ tradeIndex: i, selectedEmotions: newEmotionalStateForm.selectedEmotions, notes: newEmotionalStateForm.notes });
          }
        }
      }
      const allStatesForEntry = await invoke<JournalEmotionalState[]>("get_emotional_states_for_journal", { journalEntryId: entryId });
      const deleteGroup = async (group: JournalEmotionalState[]) => {
        for (const s of group) await invoke("delete_emotional_state", { id: s.id });
      };
      const now = new Date().toISOString();
      for (const pending of toPersist) {
        try {
          if (pending.tradeIndex === -1) {
            const entryLevel = allStatesForEntry.filter((s) => s.journal_trade_id == null);
            const groups = groupEmotionalStatesByTimestamp(entryLevel);
            for (const g of groups) await deleteGroup(g);
            for (const emotion of Object.keys(pending.selectedEmotions)) {
              await invoke("add_emotional_state", {
                timestamp: now,
                emotion,
                intensity: pending.selectedEmotions[emotion],
                notes: pending.notes || null,
                tradeId: null,
                journalEntryId: entryId,
                journalTradeId: null,
              });
            }
          } else {
            const journalTradeId = tradeIdsInOrder[pending.tradeIndex];
            if (journalTradeId != null) {
              const forTrade = allStatesForEntry.filter((s) => s.journal_trade_id === journalTradeId);
              const groups = groupEmotionalStatesByTimestamp(forTrade);
              for (const g of groups) await deleteGroup(g);
              for (const emotion of Object.keys(pending.selectedEmotions)) {
                await invoke("add_emotional_state", {
                  timestamp: now,
                  emotion,
                  intensity: pending.selectedEmotions[emotion],
                  notes: pending.notes || null,
                  tradeId: null,
                  journalEntryId: entryId,
                  journalTradeId,
                });
              }
            }
          }
        } catch (e) {
          console.error(e);
        }
      }
      if (toPersist.length > 0) {
        setShowAddEmotionalStateForm(false);
        setNewEmotionalStateForm({ selectedEmotions: {}, notes: "" });
        setNewEmotionalStateLinkScope("entry");
        setNewEmotionalStateTradeIndices([]);
        setPendingEmotionalStates([]);
      }

      await loadEntries();

      // Reload the saved entry from the server so we have a single source of truth, then switch to read-only
      await loadEntry(entryId);
      
      // Reload the saved entry
      const savedEntry = await invoke<JournalEntry>("get_journal_entry", { id: entryId });
      setSelectedEntry(savedEntry);
      await loadTrades(entryId);
      await loadLinkedPairs(entryId);
      setIsCreating(false);
      setIsEditing(false);
      setEditHistory([]);
      setOriginalEntryData(null);
      clearWorkInProgress();
    } catch (error) {
      console.error("Error saving entry:", error);
      alert("Failed to save entry: " + error);
    }
  };

  const handleCancel = () => {
    setIsCreating(false);
    setIsEditing(false);
    setEditHistory([]);
    setOriginalEntryData(null);
    setJournalTradeActualTradeIds(new Map());
    setLinkActualTradesModalJournalTradeId(null);
    setPendingEmotionalStates([]);
    clearWorkInProgress();
    if (selectedEntry) {
      // Reload the entry to reset form
      loadEntry(selectedEntry.id);
    } else {
      // Reset form if creating
      setEntryFormData({
        date: format(new Date(), "yyyy-MM-dd"),
        title: "",
        strategy_id: null,
        linked_trade_ids: [],
        linked_emotional_state_ids: [],
        linked_emotional_state_link_scopes: {},
      });
      setTradesFormData([{
        id: null,
        symbol: "",
        position: "",
        timeframe: "",
        entry_type: "",
        exit_type: "",
        trade: "",
        what_went_well: "",
        what_could_be_improved: "",
        emotional_state: "",
        notes: "",
        outcome: "Positive",
        trade_order: 0,
      }]);
      setChecklistResponses(new Map());
    }
  };

  const handleUndo = () => {
    if (editHistory.length <= 1) return; // Can't undo if we're at the initial state
    
    // Remove the last state and restore the previous one
    const newHistory = [...editHistory];
    newHistory.pop(); // Remove current state
    const previousState = newHistory[newHistory.length - 1]; // Get previous state
    
    setEditHistory(newHistory);
    setEntryFormData({
      date: previousState.entry.date,
      title: previousState.entry.title,
      strategy_id: previousState.entry.strategy_id,
      linked_trade_ids: entryFormData.linked_trade_ids ?? [],
      linked_emotional_state_ids: entryFormData.linked_emotional_state_ids ?? [],
      linked_emotional_state_link_scopes: entryFormData.linked_emotional_state_link_scopes ?? {},
    });
    
    // Deep copy trades
    const restoredTrades = previousState.trades.map(t => ({ ...t }));
    setTradesFormData(restoredTrades);
    
    // Deep copy checklist responses
    const restoredResponses = new Map<number, Map<number, boolean>>();
    for (const [tradeIndex, responses] of previousState.checklistResponses.entries()) {
      restoredResponses.set(tradeIndex, new Map(responses));
    }
    setChecklistResponses(restoredResponses);
  };

  const loadEntry = async (id: number, options?: { skipTradesFormDataSync?: boolean; restoredTradesCount?: number; openTradeId?: number }) => {
    try {
      const entry = await invoke<JournalEntry>("get_journal_entry", { id });
      setSelectedEntry(entry);
      let linkedTradeIds: number[] = [];
      if (entry.linked_trade_ids) {
        try {
          const parsed = JSON.parse(entry.linked_trade_ids) as number[];
          if (Array.isArray(parsed)) linkedTradeIds = parsed;
        } catch {
          /* ignore */
        }
      }
      setEntryFormData((prev) => ({
        ...prev,
        date: entry.date,
        title: entry.title,
        strategy_id: entry.strategy_id,
        linked_trade_ids: linkedTradeIds,
      }));
      // Save selected entry ID to localStorage
      localStorage.setItem('journal_selected_entry_id', id.toString());
      const loadedTrades = await loadTrades(id);
      if (options?.openTradeId != null && loadedTrades.length > 0) {
        const idx = loadedTrades.findIndex((t) => t.id === options.openTradeId);
        if (idx >= 0) setActiveTradeIndex(idx);
      }
      // Sync trades from DB when: (1) not skipping sync, or (2) we're restoring but saved state was bloated (DB has fewer trades)
      const shouldSyncTrades = !options?.skipTradesFormDataSync ||
        (options?.restoredTradesCount != null && loadedTrades.length < options.restoredTradesCount);
      if (shouldSyncTrades) {
        const MAX_TRADES_PER_ENTRY = 100;
        const tradesToUse = loadedTrades.length > MAX_TRADES_PER_ENTRY
          ? loadedTrades.slice(0, MAX_TRADES_PER_ENTRY)
          : loadedTrades;
        if (loadedTrades.length > MAX_TRADES_PER_ENTRY) {
          setTimeout(() => alert(`This entry had ${loadedTrades.length} trades (max ${MAX_TRADES_PER_ENTRY}). Showing first ${MAX_TRADES_PER_ENTRY}. Save to remove the extra ${loadedTrades.length - MAX_TRADES_PER_ENTRY} from the database.`), 100);
        }
        type TradeFormItem = { id: number | null; symbol: string; position: string; timeframe: string; entry_type: string; exit_type: string; trade: string; what_went_well: string; what_could_be_improved: string; emotional_state: string; notes: string; outcome: string; trade_order: number };
        const tradesData: TradeFormItem[] = tradesToUse.map((trade: JournalTrade) => ({
          id: trade.id,
          symbol: trade.symbol || "",
          position: trade.position || "",
          timeframe: trade.timeframe || "",
          entry_type: trade.entry_type || "",
          exit_type: trade.exit_type || "",
          trade: trade.trade || "",
          what_went_well: trade.what_went_well || "",
          what_could_be_improved: trade.what_could_be_improved || "",
          emotional_state: trade.emotional_state || "",
          notes: trade.notes || "",
          outcome: trade.outcome || "None",
          trade_order: trade.trade_order ?? 0,
        }));
        if (tradesData.length === 0) {
          tradesData.push({
            id: null as number | null,
            symbol: "",
            position: "",
            timeframe: "",
            entry_type: "",
            exit_type: "",
            trade: "",
            what_went_well: "",
            what_could_be_improved: "",
            emotional_state: "",
            notes: "",
            outcome: "None",
            trade_order: 0,
          });
        }
        setTradesFormData(tradesData);
        setActiveTradeIndex(0);
      }
      await loadTrades(id);
      await loadLinkedPairs(id);
      if (entry.strategy_id) {
        await loadStrategyChecklists(entry.strategy_id);
        await loadChecklistResponses(id, entry.strategy_id);
      }
      
      // Restore scroll positions after entry is loaded (entry-specific)
      // Use multiple attempts to ensure DOM is ready
      const restoreScroll = (attempt = 0) => {
        const storageKey = `journal_entry_${id}`;
        const scrollState = restoreAllScrollPositions(storageKey);
        // Restore tab scroll positions to the ref
        scrollState.tabPositions.forEach((pos, tab) => {
          tabScrollPositions.current.set(tab, pos);
        });
        // Restore left panel scroll
        if (leftPanelScrollRef.current && scrollState.leftPanelScroll !== null) {
          requestAnimationFrame(() => {
            if (leftPanelScrollRef.current) {
              leftPanelScrollRef.current.scrollTop = scrollState.leftPanelScroll!;
            }
          });
        }
        // Restore active tab scroll - try multiple times if tab content not ready
        const tabContent = tabContentRefs.current.get(activeTab);
        if (tabContent) {
          const savedPosition = tabScrollPositions.current.get(activeTab) || 0;
          if (savedPosition > 0) {
            requestAnimationFrame(() => {
              if (tabContent) {
                tabContent.scrollTop = savedPosition;
              }
            });
          }
        } else if (attempt < 5) {
          // Retry if tab content not ready yet
          setTimeout(() => restoreScroll(attempt + 1), 100);
        }
      };
      
      setTimeout(() => restoreScroll(), 200);
    } catch (error) {
      console.error("Error loading entry:", error);
    }
  };

  const updateTradeFormData = (index: number, field: string, value: any) => {
    const newTrades = [...tradesFormData];
    newTrades[index] = { ...newTrades[index], [field]: value };
    setTradesFormData(newTrades);
  };

  const toggleChecklistItem = (tradeIndex: number, itemId: number) => {
    setChecklistResponses(prev => {
      const newMap = new Map(prev);
      const tradeResponses = new Map(newMap.get(tradeIndex) || new Map());
      const current = tradeResponses.get(itemId) || false;
      tradeResponses.set(itemId, !current);
      newMap.set(tradeIndex, tradeResponses);
      return newMap;
    });
  };

  const toggleEntryLevelChecklistItem = (itemId: number) => {
    setEntryLevelChecklistResponses(prev => {
      const newMap = new Map(prev);
      newMap.set(itemId, !(prev.get(itemId) || false));
      return newMap;
    });
  };

  const setChecklistTradeAssociation = (itemId: number, tradeIds: number[] | null) => {
    setChecklistTradeAssociations(prev => new Map(prev).set(itemId, tradeIds));
    setTradeAssociationModalItemId(null);
  };

  const getChecklistTitle = (type: string): string => {
    const titleMap: Record<string, string> = {
      "daily_mantra": "Mantra",
      "daily_analysis": "Analysis",
      "entry": "Entry Checklist",
      "take_profit": "Take Profit Checklist",
      "survey": "Survey",
    };
    return titleMap[type] || type.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') + " Checklist";
  };

  const calculateEntryProbability = (tradeIndex: number): number => {
    if (!entryFormData.strategy_id) return 0;
    const checklists = strategyChecklists.get(entryFormData.strategy_id);
    if (!checklists) return 0;

    const entryItems = checklists.get("entry") || [];
    if (entryItems.length === 0) return 0;

    const tradeResponses = checklistResponses.get(tradeIndex) || new Map();
    
    // Count checkable items the same way they're rendered:
    // - Regular items (no parent_id, not a group header)
    // - Child items (has parent_id)
    // Exclude group headers (items that have children)
    const regularItems = entryItems.filter(item => !item.parent_id && !entryItems.some(child => child.parent_id === item.id));
    const groupedItems = entryItems.filter(item => item.parent_id !== null && entryItems.some(p => p.id === item.parent_id));
    
    // Total checkable items = regular items + grouped items (children)
    const totalCheckable = regularItems.length + groupedItems.length;
    
    if (totalCheckable === 0) return 0;

    let checked = 0;
    // Count checked regular items
    for (const item of regularItems) {
      if (tradeResponses.get(item.id)) {
        checked++;
      }
    }
    // Count checked grouped items (children)
    for (const item of groupedItems) {
      if (tradeResponses.get(item.id)) {
        checked++;
      }
    }

    const percentage = (checked / totalCheckable) * 100;
    return Math.round(percentage);
  };

  const calculateTakeProfitImplementation = (tradeIndex: number): number => {
    if (!entryFormData.strategy_id) return 0;
    const checklists = strategyChecklists.get(entryFormData.strategy_id);
    if (!checklists) return 0;

    const takeProfitItems = checklists.get("take_profit") || [];
    if (takeProfitItems.length === 0) return 0;

    const tradeResponses = checklistResponses.get(tradeIndex) || new Map();
    
    // Count checkable items the same way they're rendered:
    // - Regular items (no parent_id, not a group header)
    // - Child items (has parent_id)
    // Exclude group headers (items that have children)
    const regularItems = takeProfitItems.filter(item => !item.parent_id && !takeProfitItems.some(child => child.parent_id === item.id));
    const groupedItems = takeProfitItems.filter(item => item.parent_id !== null && takeProfitItems.some(p => p.id === item.parent_id));
    
    // Total checkable items = regular items + grouped items (children)
    const totalCheckable = regularItems.length + groupedItems.length;
    
    if (totalCheckable === 0) return 0;

    let checked = 0;
    // Count checked regular items
    for (const item of regularItems) {
      if (tradeResponses.get(item.id)) {
        checked++;
      }
    }
    // Count checked grouped items (children)
    for (const item of groupedItems) {
      if (tradeResponses.get(item.id)) {
        checked++;
      }
    }

    const percentage = (checked / totalCheckable) * 100;
    return Math.round(percentage);
  };

  const calculateChecklistProgress = (tradeIndex: number, checklistType: string): number => {
    if (!entryFormData.strategy_id) return 0;
    const checklists = strategyChecklists.get(entryFormData.strategy_id);
    if (!checklists) return 0;

    const items = checklists.get(checklistType) || [];
    if (items.length === 0) return 0;

    const isEntryLevelType = ENTRY_LEVEL_CHECKLIST_TYPES.includes(checklistType);
    const tradeResponses = isEntryLevelType
      ? entryLevelChecklistResponses
      : (checklistResponses.get(tradeIndex) || new Map());
    const entryTradesHere = selectedEntry ? selectedTrades : tradesFormData;
    const tradeKey = selectedEntry && entryTradesHere[tradeIndex] && (entryTradesHere[tradeIndex] as { id?: number }).id != null
      ? (entryTradesHere[tradeIndex] as { id: number }).id
      : (entryTradesHere.length > tradeIndex ? tradeIndex : undefined);
    const entryLevelAppliesHere = (itemId: number) => {
      const assoc = checklistTradeAssociations.get(itemId);
      if (!assoc || assoc.length === 0) return true;
      return tradeKey !== undefined && assoc.includes(tradeKey);
    };
    
    // Count checkable items the same way they're rendered:
    // - Regular items (no parent_id, not a group header)
    // - Child items (has parent_id)
    // Exclude group headers (items that have children)
    const regularItems = items.filter(item => !item.parent_id && !items.some(child => child.parent_id === item.id));
    const groupedItems = items.filter(item => item.parent_id !== null && items.some(p => p.id === item.parent_id));
    
    // Total checkable items = regular items + grouped items (children)
    const totalCheckable = regularItems.length + groupedItems.length;
    
    if (totalCheckable === 0) return 0;

    const isCheckedHere = (itemId: number) =>
      isEntryLevelType
        ? (tradeResponses.get(itemId) || false) && entryLevelAppliesHere(itemId)
        : (tradeResponses.get(itemId) || false);
    let checked = 0;
    for (const item of regularItems) {
      if (isCheckedHere(item.id)) checked++;
    }
    for (const item of groupedItems) {
      if (isCheckedHere(item.id)) checked++;
    }

    const percentage = (checked / totalCheckable) * 100;
    return Math.round(percentage);
  };

  const currentTrade = tradesFormData[activeTradeIndex];
  const currentChecklists = entryFormData.strategy_id ? strategyChecklists.get(entryFormData.strategy_id) : null;
  // Trades that belong to this journal entry only (for Associate modal). When editing, use tradesFormData (set from loaded trades in handleEdit) so we always show the correct 7; when viewing, use selectedTrades.
  const entryTradesForAssociation = selectedEntry && !isEditing ? selectedTrades : tradesFormData;
  const defaultTypes = ["daily_analysis", "daily_mantra", "entry", "take_profit"];
  const customTypes = currentChecklists 
    ? Array.from(currentChecklists.keys()).filter(t => !defaultTypes.includes(t) && t !== "survey")
    : [];
  const allTypes = [...defaultTypes, ...customTypes.filter(t => !defaultTypes.includes(t))];

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden", flex: 1 }}>
      {/* Left Panel - Entry Details */}
      <div
        style={{
          flex: "2",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "var(--bg-primary)",
          overflow: "hidden",
        }}
      >
        {selectedEntry && !isCreating && !isEditing ? (
          <>
            <div style={{ padding: "24px", borderBottom: "1px solid var(--border-color)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ fontSize: "24px", fontWeight: "bold", marginBottom: "8px" }}>
                {format(parse(selectedEntry.date, "yyyy-MM-dd", new Date()), "MM/dd/yyyy")} - {selectedEntry.title}
              </h2>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <button
                  onClick={() => setIsMaximized(!isMaximized)}
                  style={{
                    background: "var(--bg-tertiary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "6px",
                    padding: "8px",
                    color: "var(--text-primary)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                  }}
                  title={isMaximized ? "Restore" : "Maximize"}
                >
                  {isMaximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                </button>
                <button
                  onClick={handleEdit}
                  style={{
                    background: "var(--bg-tertiary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "6px",
                    padding: "8px",
                    color: "var(--text-primary)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                  }}
                  title="Edit"
                >
                  <Edit2 size={16} />
                </button>
                <button
                  onClick={handleDeleteClick}
                  style={{
                    background: "var(--bg-tertiary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "6px",
                    padding: "8px",
                    color: "var(--danger)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                  }}
                  title="Delete"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: "4px", display: "block" }}>
                    Date
                  </label>
                  <div style={{ color: "var(--text-primary)", fontSize: "14px" }}>
                    {selectedEntry.date}
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: "4px", display: "block" }}>
                    Title
                  </label>
                  <div style={{ color: "var(--text-primary)", fontSize: "14px" }}>
                    {selectedEntry.title}
                  </div>
                </div>
                {selectedEntry.strategy_id && (
                  <div>
                    <label style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: "4px", display: "block" }}>
                      Strategy
                    </label>
                    <div style={{ color: "var(--text-primary)", fontSize: "14px" }}>
                      {strategies.find(s => s.id === selectedEntry.strategy_id)?.name || "Unknown"}
                    </div>
                  </div>
                )}

                {/* Display all trades */}
                {selectedTrades.length > 0 && (
                  <div style={{ marginTop: "24px" }}>
                    <h3 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "16px", color: "var(--text-primary)" }}>
                      Trades ({selectedTrades.length})
                    </h3>
                    {selectedTrades.map((trade, index) => {
                      const tradeName = trade.symbol
                        ? (trade.position ? `${trade.symbol} (${trade.position})` : trade.symbol)
                        : `Trade ${index + 1}`;
                      return (
                      <div key={trade.id || index} style={{ marginBottom: "24px", padding: "16px", backgroundColor: "var(--bg-secondary)", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
                        <h4 style={{ fontSize: "14px", fontWeight: "600", marginBottom: "12px", color: "var(--text-primary)" }}>
                          {tradeName}
                        </h4>
                        {trade.symbol && (
                          <div style={{ marginBottom: "8px" }}>
                            <label style={{ fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: "4px", display: "block" }}>
                              Symbol
                            </label>
                            <div style={{ color: "var(--text-primary)", fontSize: "14px" }}>
                              {trade.symbol}
                            </div>
                          </div>
                        )}
                        {trade.position && (
                          <div style={{ marginBottom: "8px" }}>
                            <label style={{ fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: "4px", display: "block" }}>
                              Position
                            </label>
                            <div style={{ color: "var(--text-primary)", fontSize: "14px" }}>
                              {trade.position}
                            </div>
                          </div>
                        )}
                        {trade.timeframe && (
                          <div style={{ marginBottom: "8px" }}>
                            <label style={{ fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: "4px", display: "block" }}>
                              Trade Timeframe
                            </label>
                            <div style={{ color: "var(--text-primary)", fontSize: "14px" }}>
                              {trade.timeframe}
                            </div>
                          </div>
                        )}
                        {trade.entry_type && (
                          <div style={{ marginBottom: "8px" }}>
                            <label style={{ fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: "4px", display: "block" }}>
                              Entry Type
                            </label>
                            <div style={{ color: "var(--text-primary)", fontSize: "14px" }}>
                              {trade.entry_type}
                            </div>
                          </div>
                        )}
                        {trade.exit_type && (
                          <div style={{ marginBottom: "8px" }}>
                            <label style={{ fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: "4px", display: "block" }}>
                              Exit Type
                            </label>
                            <div style={{ color: "var(--text-primary)", fontSize: "14px" }}>
                              {trade.exit_type}
                            </div>
                          </div>
                        )}
                        {trade.outcome && (
                          <div style={{ marginBottom: "8px" }}>
                            <label style={{ fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: "4px", display: "block" }}>
                              Outcome
                            </label>
                            <div style={{ color: "var(--text-primary)", fontSize: "14px" }}>
                              {trade.outcome}
                            </div>
                          </div>
                        )}
                        {trade.trade && (
                          <div style={{ marginBottom: "24px" }}>
                            <label style={{ fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: "8px", display: "block" }}>
                              Trade
                            </label>
                            <div style={{ 
                              overflow: "hidden"
                            }}>
                              <RichTextEditor
                                value={trade.trade || ""}
                                onChange={() => {}}
                                readOnly={true}
                              />
                            </div>
                          </div>
                        )}
                        {trade.what_went_well && (
                          <div style={{ marginBottom: "24px" }}>
                            <label style={{ fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: "8px", display: "block" }}>
                              What Went Well
                            </label>
                            <div style={{ 
                              overflow: "hidden"
                            }}>
                              <RichTextEditor
                                value={trade.what_went_well || ""}
                                onChange={() => {}}
                                readOnly={true}
                              />
                            </div>
                          </div>
                        )}
                        {trade.what_could_be_improved && (
                          <div style={{ marginBottom: "24px" }}>
                            <label style={{ fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: "8px", display: "block" }}>
                              What Could Be Improved
                            </label>
                            <div style={{ 
                              overflow: "hidden"
                            }}>
                              <RichTextEditor
                                value={trade.what_could_be_improved || ""}
                                onChange={() => {}}
                                readOnly={true}
                              />
                            </div>
                          </div>
                        )}
                        {trade.emotional_state && (
                          <div style={{ marginBottom: "24px" }}>
                            <label style={{ fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: "8px", display: "block" }}>
                              Emotional State
                            </label>
                            <div style={{ 
                              overflow: "hidden"
                            }}>
                              <RichTextEditor
                                value={trade.emotional_state || ""}
                                onChange={() => {}}
                                readOnly={true}
                              />
                            </div>
                          </div>
                        )}
                        {trade.notes && (
                          <div style={{ marginBottom: "24px" }}>
                            <label style={{ fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: "8px", display: "block" }}>
                              Notes
                            </label>
                            <div style={{ 
                              overflow: "hidden"
                            }}>
                              <RichTextEditor
                                value={trade.notes || ""}
                                onChange={() => {}}
                                readOnly={true}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                    })}
                  </div>
                )}

                {/* Emotional state entries - at bottom, collapsible, hidden by default */}
                <div style={{ marginTop: "24px" }}>
                  <button
                    type="button"
                    onClick={() => setEmotionalStatesSectionExpanded((e) => !e)}
                    title={emotionalStatesSectionExpanded ? "Click to collapse" : "Click to expand"}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      width: "100%",
                      padding: "12px 16px",
                      margin: 0,
                      background: "var(--bg-secondary)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "8px",
                      cursor: "pointer",
                      color: "var(--text-primary)",
                      fontSize: "15px",
                      fontWeight: 600,
                      textAlign: "left",
                      boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = "var(--bg-tertiary)";
                      e.currentTarget.style.borderColor = "var(--accent)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = "var(--bg-secondary)";
                      e.currentTarget.style.borderColor = "var(--border-color)";
                    }}
                  >
                    {emotionalStatesSectionExpanded ? (
                      <ChevronDown size={20} style={{ flexShrink: 0 }} />
                    ) : (
                      <ChevronRight size={20} style={{ flexShrink: 0 }} />
                    )}
                    <span>Emotional state entries ({viewEntryEmotionalStates.length > 0 ? groupEmotionalStatesByTimestamp(viewEntryEmotionalStates).length : 0})</span>
                    <span style={{ marginLeft: "auto", fontSize: "12px", fontWeight: 400, color: "var(--text-secondary)" }}>
                      {emotionalStatesSectionExpanded ? "Click to collapse" : "Click to expand"}
                    </span>
                  </button>
                  {emotionalStatesSectionExpanded && (
                    <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
                      {viewEntryEmotionalStates.length === 0 ? (
                        <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>No emotional state entries linked to this journal.</p>
                      ) : (
                        groupEmotionalStatesByTimestamp(viewEntryEmotionalStates).map((group) => {
                          const first = group[0];
                          const notes = first.notes;
                          return (
                            <div
                              key={first.timestamp}
                              style={{
                                padding: "12px",
                                backgroundColor: "var(--bg-secondary)",
                                border: "1px solid var(--border-color)",
                                borderRadius: "6px",
                              }}
                            >
                              <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "6px" }}>
                                {format(new Date(first.timestamp), "MMM d, yyyy HH:mm")}
                              </div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center", marginBottom: notes ? "8px" : 0 }}>
                                {group.map((s) => (
                                  <span key={s.id} style={{ fontWeight: "600", color: "var(--text-primary)", fontSize: "13px" }}>
                                    {s.emotion} {s.intensity}/10
                                  </span>
                                ))}
                              </div>
                              {notes && (
                                <div style={{ fontSize: "13px", color: "var(--text-secondary)" }} dangerouslySetInnerHTML={{ __html: notes }} />
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
                {/* Linked trade pairs with charts */}
                {linkedPairs.length > 0 && (
                  <div style={{ marginTop: "24px" }}>
                    <h3 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "16px", color: "var(--text-primary)" }}>
                      Linked trade pairs ({linkedPairs.length})
                    </h3>
                    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                      {linkedPairs.map((pair) => (
                        <div
                          key={`${pair.entry_trade_id}_${pair.exit_trade_id}`}
                          style={{
                            padding: "16px",
                            backgroundColor: "var(--bg-secondary)",
                            borderRadius: "8px",
                            border: "1px solid var(--border-color)",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", flexWrap: "wrap", gap: "8px" }}>
                            <span style={{ fontWeight: "600", color: "var(--text-primary)" }}>{pair.symbol}</span>
                            <span style={{ color: pair.net_profit_loss >= 0 ? "var(--profit)" : "var(--loss)", fontSize: "14px" }}>
                              P&L: ${pair.net_profit_loss >= 0 ? "" : "-"}${Math.abs(pair.net_profit_loss).toFixed(2)}
                            </span>
                          </div>
                          <TradeChart
                            symbol={pair.symbol}
                            entryTimestamp={pair.entry_timestamp}
                            exitTimestamp={pair.exit_timestamp}
                            entryPrice={pair.entry_price}
                            exitPrice={pair.exit_price}
                            inline
                            compactHeight={200}
                          />
                          <div style={{ marginTop: "8px" }}>
                            <button
                              onClick={() => setSelectedPairForChart(pair)}
                              style={{
                                fontSize: "12px",
                                padding: "6px 12px",
                                background: "var(--bg-tertiary)",
                                border: "1px solid var(--border-color)",
                                borderRadius: "4px",
                                color: "var(--text-primary)",
                                cursor: "pointer",
                              }}
                            >
                              View full chart
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (isCreating || isEditing) ? (
          <>
            <div style={{ padding: "20px", borderBottom: "1px solid var(--border-color)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ fontSize: "20px", fontWeight: "bold" }}>Journal Entry</h2>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <button
                  onClick={() => setIsMaximized(!isMaximized)}
                  style={{
                    background: "var(--bg-tertiary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "6px",
                    padding: "8px",
                    color: "var(--text-primary)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                  }}
                  title={isMaximized ? "Restore" : "Maximize"}
                >
                  {isMaximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                </button>
                {isEditing && editHistory.length > 1 && (
                  <button
                    onClick={handleUndo}
                    style={{
                      background: "var(--bg-tertiary)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "6px",
                      padding: "8px",
                      color: "var(--text-primary)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                    }}
                    title="Undo"
                  >
                    <RotateCcw size={16} />
                  </button>
                )}
                <button
                  onClick={handleSave}
                  style={{
                    background: "var(--accent)",
                    border: "none",
                    borderRadius: "6px",
                    padding: "8px 12px",
                    color: "white",
                    cursor: "pointer",
                    fontSize: "13px",
                    fontWeight: "500",
                  }}
                  title="Save"
                >
                  Save
                </button>
                <button
                  onClick={handleCancel}
                  style={{
                    background: "var(--bg-tertiary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "6px",
                    padding: "8px 12px",
                    color: "var(--text-primary)",
                    cursor: "pointer",
                    fontSize: "13px",
                  }}
                  title="Cancel"
                >
                  Cancel
                </button>
              </div>
            </div>
            <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
              {!isTabContentMaximized && (
                <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border-color)", backgroundColor: "var(--bg-secondary)" }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", alignItems: "flex-end" }}>
                    <div style={{ flex: "0 0 120px", minWidth: "100px" }}>
                      <label style={{ display: "block", marginBottom: "4px", fontSize: "12px", fontWeight: "500", color: "var(--text-secondary)" }}>
                        Date
                      </label>
                      <input
                        type="date"
                        value={entryFormData.date}
                        onChange={(e) => setEntryFormData({ ...entryFormData, date: e.target.value })}
                        style={{
                          width: "100%",
                          padding: "6px 8px",
                          backgroundColor: "var(--bg-primary)",
                          border: "1px solid var(--border-color)",
                          borderRadius: "4px",
                          color: "var(--text-primary)",
                          fontSize: "14px",
                        }}
                      />
                    </div>
                    <div style={{ flex: "1 1 200px", minWidth: "140px" }}>
                      <label style={{ display: "block", marginBottom: "4px", fontSize: "12px", fontWeight: "500", color: "var(--text-secondary)" }}>
                        Title
                      </label>
                      <input
                        ref={titleInputRef}
                        type="text"
                        value={entryFormData.title}
                        onChange={(e) => {
                          const newData = { ...entryFormData, title: e.target.value };
                          setEntryFormData(newData);
                          if (isEditing) {
                            const currentState = {
                              entry: newData,
                              trades: tradesFormData.map(t => ({ ...t })),
                              checklistResponses: new Map(checklistResponses),
                            };
                            setEditHistory(prev => [...prev, currentState].slice(-10));
                          }
                        }}
                        placeholder="Entry title..."
                        style={{
                          width: "100%",
                          padding: "6px 8px",
                          backgroundColor: "var(--bg-primary)",
                          border: "1px solid var(--border-color)",
                          borderRadius: "4px",
                          color: "var(--text-primary)",
                          fontSize: "14px",
                        }}
                      />
                    </div>
                    <div style={{ flex: "0 0 180px", minWidth: "140px" }}>
                      <label style={{ display: "block", marginBottom: "4px", fontSize: "12px", fontWeight: "500", color: "var(--text-secondary)" }}>
                        Strategy
                      </label>
                      <select
                        value={entryFormData.strategy_id || ""}
                        onChange={(e) => setEntryFormData({ ...entryFormData, strategy_id: e.target.value ? parseInt(e.target.value) : null })}
                        style={{
                          width: "100%",
                          padding: "6px 8px",
                          backgroundColor: "var(--bg-primary)",
                          border: "1px solid var(--border-color)",
                          borderRadius: "4px",
                          color: "var(--text-primary)",
                          fontSize: "14px",
                        }}
                      >
                        <option value="">Select a strategy...</option>
                        {strategies.map((strategy) => (
                          <option key={strategy.id} value={strategy.id}>
                            {strategy.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* Trade Tabs */}
              {!isTabContentMaximized && (
                <div
                  style={{
                    display: "flex",
                    borderBottom: "1px solid var(--border-color)",
                    backgroundColor: "var(--bg-secondary)",
                    overflowX: "auto",
                  }}
                >
                {tradesFormData.map((trade, index) => {
                  const isActive = activeTradeIndex === index;
                  const tabLabel = trade.symbol || `Trade ${index + 1}`;
                  return (
                    <div key={index} style={{ display: "flex", alignItems: "center" }}>
                      <button
                        onClick={() => setActiveTradeIndex(index)}
                        style={{
                          padding: "12px 20px",
                          background: isActive ? "var(--bg-primary)" : "transparent",
                          border: "none",
                          borderBottom: isActive ? "2px solid var(--accent)" : "2px solid transparent",
                          color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                          cursor: "pointer",
                          fontSize: "14px",
                          fontWeight: isActive ? "600" : "400",
                          transition: "all 0.2s",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {tabLabel}
                      </button>
                      {tradesFormData.length > 1 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveTrade(index);
                          }}
                          style={{
                            padding: "4px 8px",
                            background: "transparent",
                            border: "none",
                            color: "var(--danger)",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                          }}
                          title="Remove Trade"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  );
                })}
                <button
                  type="button"
                  onClick={handleAddTrade}
                  style={{
                    padding: "12px 20px",
                    background: "transparent",
                    border: "none",
                    color: "var(--accent)",
                    cursor: "pointer",
                    fontSize: "14px",
                    fontWeight: "400",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                  title="Add trade"
                >
                  <Plus size={16} />
                  Add Trade
                </button>
              </div>
              )}

              {/* Content Tabs for Current Trade */}
              {currentTrade && (
                <>
                  {/* Trade-specific fields - Symbol, Position, Entry Type, Exit Type, and Outcome */}
                  {!isTabContentMaximized && (
                    <div style={{ padding: "20px", borderBottom: "1px solid var(--border-color)", backgroundColor: "var(--bg-secondary)" }}>
                    <div style={{ display: "flex", gap: "12px" }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ display: "block", marginBottom: "6px", fontSize: "12px", fontWeight: "500" }}>
                          Symbol
                        </label>
                        <div style={{ position: "relative" }}>
                          <input
                            type="text"
                            list={`symbol-list-${activeTradeIndex}`}
                            value={currentTrade.symbol}
                            onChange={(e) => updateTradeFormData(activeTradeIndex, "symbol", e.target.value)}
                            placeholder="Symbol..."
                            style={{
                              width: "100%",
                              padding: "8px",
                              backgroundColor: "var(--bg-primary)",
                              border: "1px solid var(--border-color)",
                              borderRadius: "4px",
                              color: "var(--text-primary)",
                              fontSize: "14px",
                            }}
                          />
                          <datalist id={`symbol-list-${activeTradeIndex}`}>
                            {availableSymbols.map((symbol) => (
                              <option key={symbol} value={symbol} />
                            ))}
                          </datalist>
                        </div>
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ display: "block", marginBottom: "6px", fontSize: "12px", fontWeight: "500" }}>
                          Position
                        </label>
                        <select
                          value={currentTrade.position}
                          onChange={(e) => updateTradeFormData(activeTradeIndex, "position", e.target.value)}
                          style={{
                            width: "100%",
                            padding: "8px",
                            backgroundColor: "var(--bg-primary)",
                            border: "1px solid var(--border-color)",
                            borderRadius: "4px",
                            color: "var(--text-primary)",
                            fontSize: "14px",
                          }}
                        >
                          <option value="">Select position...</option>
                          <option value="Long">Long</option>
                          <option value="Short">Short</option>
                          <option value="Call">Call</option>
                          <option value="Put">Put</option>
                          <option value="Call Spread">Call Spread</option>
                          <option value="Put Spread">Put Spread</option>
                          <option value="Iron Condor">Iron Condor</option>
                          <option value="Butterfly">Butterfly</option>
                          <option value="Straddle">Straddle</option>
                          <option value="Strangle">Strangle</option>
                          <option value="Covered Call">Covered Call</option>
                          <option value="Protective Put">Protective Put</option>
                        </select>
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ display: "block", marginBottom: "6px", fontSize: "12px", fontWeight: "500" }}>
                          Trade Timeframe
                        </label>
                        <select
                          value={currentTrade.timeframe}
                          onChange={(e) => updateTradeFormData(activeTradeIndex, "timeframe", e.target.value)}
                          style={{
                            width: "100%",
                            padding: "8px",
                            backgroundColor: "var(--bg-primary)",
                            border: "1px solid var(--border-color)",
                            borderRadius: "4px",
                            color: "var(--text-primary)",
                            fontSize: "14px",
                          }}
                        >
                          <option value="">Select timeframe...</option>
                          <option value="1s">1 Second</option>
                          <option value="5s">5 Seconds</option>
                          <option value="10s">10 Seconds</option>
                          <option value="15s">15 Seconds</option>
                          <option value="30s">30 Seconds</option>
                          <option value="1m">1 Minute</option>
                          <option value="2m">2 Minutes</option>
                          <option value="3m">3 Minutes</option>
                          <option value="5m">5 Minutes</option>
                          <option value="7m">7 Minutes</option>
                          <option value="10m">10 Minutes</option>
                          <option value="15m">15 Minutes</option>
                          <option value="20m">20 Minutes</option>
                          <option value="30m">30 Minutes</option>
                          <option value="1h">1 Hour</option>
                          <option value="2h">2 Hours</option>
                          <option value="3h">3 Hours</option>
                          <option value="4h">4 Hours</option>
                          <option value="6h">6 Hours</option>
                          <option value="8h">8 Hours</option>
                          <option value="12h">12 Hours</option>
                          <option value="1d">1 Day</option>
                          <option value="2d">2 Days</option>
                          <option value="3d">3 Days</option>
                          <option value="1w">1 Week</option>
                          <option value="1M">1 Month</option>
                        </select>
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ display: "block", marginBottom: "6px", fontSize: "12px", fontWeight: "500" }}>
                          Entry Type
                        </label>
                        <select
                          value={currentTrade.entry_type}
                          onChange={(e) => updateTradeFormData(activeTradeIndex, "entry_type", e.target.value)}
                          style={{
                            width: "100%",
                            padding: "8px",
                            backgroundColor: "var(--bg-primary)",
                            border: "1px solid var(--border-color)",
                            borderRadius: "4px",
                            color: "var(--text-primary)",
                            fontSize: "14px",
                          }}
                        >
                          <option value="">Select entry type...</option>
                          <option value="Market">Market</option>
                          <option value="Limit">Limit</option>
                        </select>
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ display: "block", marginBottom: "6px", fontSize: "12px", fontWeight: "500" }}>
                          Exit Type
                        </label>
                        <select
                          value={currentTrade.exit_type}
                          onChange={(e) => updateTradeFormData(activeTradeIndex, "exit_type", e.target.value)}
                          style={{
                            width: "100%",
                            padding: "8px",
                            backgroundColor: "var(--bg-primary)",
                            border: "1px solid var(--border-color)",
                            borderRadius: "4px",
                            color: "var(--text-primary)",
                            fontSize: "14px",
                          }}
                        >
                          <option value="">Select exit type...</option>
                          <option value="Market">Market</option>
                          <option value="Limit">Limit</option>
                        </select>
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ display: "block", marginBottom: "6px", fontSize: "12px", fontWeight: "500" }}>
                          Outcome
                        </label>
                        <select
                          value={currentTrade.outcome}
                          onChange={(e) => updateTradeFormData(activeTradeIndex, "outcome", e.target.value)}
                          style={{
                            width: "100%",
                            padding: "8px",
                            backgroundColor: "var(--bg-primary)",
                            border: "1px solid var(--border-color)",
                            borderRadius: "4px",
                            color: "var(--text-primary)",
                            fontSize: "14px",
                          }}
                        >
                          <option value="None">None</option>
                          <option value="Positive">Positive</option>
                          <option value="Negative">Negative</option>
                          <option value="Breakeven">Breakeven</option>
                        </select>
                      </div>
                    </div>
                    {/* Link this journal trade to actual trades (from Trades table) - only when editing and journal trade has id */}
                    {isEditing && currentTrade.id != null && (
                      <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid var(--border-color)" }}>
                        <label style={{ display: "block", marginBottom: "6px", fontSize: "12px", fontWeight: "500", color: "var(--text-secondary)" }}>
                          Link to actual trades
                        </label>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                          <span style={{ fontSize: "13px", color: "var(--text-primary)" }}>
                            {(journalTradeActualTradeIds.get(currentTrade.id)?.length ?? 0) > 0
                              ? `${journalTradeActualTradeIds.get(currentTrade.id)!.length} actual trade(s) linked`
                              : "No actual trades linked"}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setLinkActualTradesSelection(journalTradeActualTradeIds.get(currentTrade.id!) ?? []);
                              setLinkActualTradesModalJournalTradeId(currentTrade.id!);
                            }}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                              padding: "6px 12px",
                              background: "var(--bg-tertiary)",
                              border: "1px solid var(--border-color)",
                              borderRadius: "6px",
                              color: "var(--accent)",
                              cursor: "pointer",
                              fontSize: "13px",
                            }}
                          >
                            <Link2 size={14} />
                            {journalTradeActualTradeIds.get(currentTrade.id)?.length ? "Edit links" : "Link to actual trades"}
                          </button>
                        </div>
                        <p style={{ margin: "4px 0 0", fontSize: "11px", color: "var(--text-secondary)" }}>
                          Associate this journal trade with real trades from your Trades list.
                        </p>
                      </div>
                    )}
                  </div>
                  )}

                  {/* Link trade pairs - above the text area tabs */}
                  {selectedEntry?.id && !isTabContentMaximized && (
                    <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border-color)", backgroundColor: "var(--bg-secondary)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: linkedPairs.length > 0 ? "10px" : 0 }}>
                        <button
                          type="button"
                          onClick={async () => {
                            setShowLinkPairsModal(true);
                            setLinkPairsSearchQuery("");
                            setLinkPairsSortBy("date");
                            setLinkPairsSortDirection("desc");
                            const pairingMethod = localStorage.getItem("tradebutler_pairing_method") || "FIFO";
                            const all = await invoke<PairedTrade[]>("get_paired_trades", { pairingMethod: pairingMethod || null });
                            setAllPairsForPicker(all);
                            const current = linkedPairs.map(p => `${p.entry_trade_id}_${p.exit_trade_id}`);
                            setLinkPickerSelected(new Set(current));
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            padding: "8px 14px",
                            backgroundColor: "var(--bg-tertiary)",
                            border: "1px solid var(--border-color)",
                            borderRadius: "6px",
                            color: "var(--text-primary)",
                            fontSize: "13px",
                            fontWeight: "500",
                            cursor: "pointer",
                          }}
                        >
                          <Link2 size={16} />
                          Link trade pairs
                        </button>
                        {linkedPairs.length > 0 && (
                          <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                            {linkedPairs.length} pair{linkedPairs.length !== 1 ? "s" : ""} linked
                          </span>
                        )}
                      </div>
                      {linkedPairs.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                          {linkedPairs.map((pair) => (
                            <div
                              key={`${pair.entry_trade_id}-${pair.exit_trade_id}`}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "0",
                                backgroundColor: "var(--bg-primary)",
                                border: "1px solid var(--border-color)",
                                borderRadius: "6px",
                                overflow: "hidden",
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => setSelectedPairForChart(pair)}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "6px",
                                  padding: "6px 12px",
                                  background: "none",
                                  border: "none",
                                  color: "var(--text-primary)",
                                  fontSize: "13px",
                                  cursor: "pointer",
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.backgroundColor = "var(--bg-tertiary)";
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.backgroundColor = "transparent";
                                }}
                              >
                                <BarChart3 size={14} />
                                {pair.symbol} {format(new Date(pair.entry_timestamp), "MMM d")} → {format(new Date(pair.exit_timestamp), "MMM d")}
                                <span style={{ color: pair.net_profit_loss >= 0 ? "var(--profit)" : "var(--loss)", fontWeight: "600" }}>
                                  {pair.net_profit_loss >= 0 ? "+" : ""}{pair.net_profit_loss.toFixed(2)}
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (!selectedEntry?.id) return;
                                  const remaining = linkedPairs.filter(
                                    (p) => !(p.entry_trade_id === pair.entry_trade_id && p.exit_trade_id === pair.exit_trade_id)
                                  );
                                  try {
                                    await invoke("set_journal_entry_pairs", {
                                      journalEntryId: selectedEntry.id,
                                      pairs: remaining.map((p) => ({ entry_trade_id: p.entry_trade_id, exit_trade_id: p.exit_trade_id })),
                                    });
                                    setLinkedPairs(remaining);
                                  } catch (err) {
                                    console.error("Failed to unlink pair:", err);
                                    alert("Failed to unlink pair.");
                                  }
                                }}
                                title="Unlink from journal entry"
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  padding: "6px 8px",
                                  background: "none",
                                  border: "none",
                                  borderLeft: "1px solid var(--border-color)",
                                  color: "var(--text-secondary)",
                                  cursor: "pointer",
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.backgroundColor = "var(--loss)";
                                  e.currentTarget.style.color = "white";
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.backgroundColor = "transparent";
                                  e.currentTarget.style.color = "var(--text-secondary)";
                                }}
                              >
                                <X size={14} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {!isTabContentMaximized && (
                    <div
                      style={{
                        display: "flex",
                        borderBottom: "1px solid var(--border-color)",
                        backgroundColor: "var(--bg-secondary)",
                      }}
                    >
                    {[
                      { id: "trade" as TabType, label: "Implementation" },
                      { id: "what_went_well" as TabType, label: "What Went Well" },
                      { id: "what_could_be_improved" as TabType, label: "What Could Be Improved" },
                      { id: "emotional_state" as TabType, label: "Emotional State" },
                      { id: "notes" as TabType, label: "Notes" },
                      { id: "checklists" as TabType, label: "Checklists" },
                      { id: "survey" as TabType, label: "Survey" },
                      { id: "links" as TabType, label: "Links" },
                    ].map((tab) => {
                      const isActive = activeTab === tab.id;
                      return (
                        <button
                          key={tab.id}
                          onClick={() => handleTabChange(tab.id)}
                          style={{
                            padding: "12px 20px",
                            background: isActive ? "var(--bg-primary)" : "transparent",
                            border: "none",
                            borderBottom: isActive ? "2px solid var(--accent)" : "2px solid transparent",
                            color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                            cursor: "pointer",
                            fontSize: "14px",
                            fontWeight: isActive ? "600" : "400",
                            transition: "all 0.2s",
                          }}
                        >
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>
                  )}

                  {/* Tab Content */}
                  <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", padding: isTabContentMaximized ? "40px" : "20px", position: "relative" }}>
                    {/* Maximize button for tab content */}
                    <button
                      onClick={() => setIsTabContentMaximized(!isTabContentMaximized)}
                      style={{
                        position: "absolute",
                        top: isTabContentMaximized ? "40px" : "20px",
                        right: isTabContentMaximized ? "40px" : "20px",
                        zIndex: 10,
                        background: "var(--bg-tertiary)",
                        border: "1px solid var(--border-color)",
                        borderRadius: "6px",
                        padding: "8px",
                        color: "var(--text-primary)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.2)",
                      }}
                      title={isTabContentMaximized ? "Restore" : "Maximize"}
                    >
                      {isTabContentMaximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                    </button>
                    {/* Show active tab label and switcher when maximized */}
                    {isTabContentMaximized && (
                      <div style={{ marginBottom: "20px", paddingBottom: "16px", borderBottom: "1px solid var(--border-color)" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                          <h3 style={{ fontSize: "18px", fontWeight: "600", color: "var(--text-primary)" }}>
                            {[
                              { id: "trade" as TabType, label: "Implementation" },
                              { id: "what_went_well" as TabType, label: "What Went Well" },
                              { id: "what_could_be_improved" as TabType, label: "What Could Be Improved" },
                              { id: "emotional_state" as TabType, label: "Emotional State" },
                              { id: "notes" as TabType, label: "Notes" },
                              { id: "checklists" as TabType, label: "Checklists" },
                              { id: "survey" as TabType, label: "Survey" },
                              { id: "links" as TabType, label: "Links" },
                            ].find(tab => tab.id === activeTab)?.label || "Tab"}
                          </h3>
                        </div>
                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                          {[
                            { id: "trade" as TabType, label: "Implementation" },
                            { id: "what_went_well" as TabType, label: "What Went Well" },
                            { id: "what_could_be_improved" as TabType, label: "What Could Be Improved" },
                            { id: "emotional_state" as TabType, label: "Emotional State" },
                            { id: "notes" as TabType, label: "Notes" },
                            { id: "checklists" as TabType, label: "Checklists" },
                            { id: "survey" as TabType, label: "Survey" },
                            { id: "links" as TabType, label: "Links" },
                          ].map((tab) => {
                            const isActive = activeTab === tab.id;
                            return (
                              <button
                                key={tab.id}
                                onClick={() => handleTabChange(tab.id)}
                                style={{
                                  padding: "8px 16px",
                                  background: isActive ? "var(--accent)" : "var(--bg-tertiary)",
                                  border: `1px solid ${isActive ? "var(--accent)" : "var(--border-color)"}`,
                                  borderRadius: "6px",
                                  color: isActive ? "white" : "var(--text-primary)",
                                  cursor: "pointer",
                                  fontSize: "13px",
                                  fontWeight: isActive ? "600" : "400",
                                  transition: "all 0.2s",
                                }}
                              >
                                {tab.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {activeTab === "trade" && (
                      <div 
                        ref={(el) => { tabContentRefs.current.set("trade", el); }}
                        style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto", minHeight: 0 }}
                        onScroll={(e) => { 
                          tabScrollPositions.current.set("trade", e.currentTarget.scrollTop);
                          const storageKey = selectedEntry?.id ? `journal_entry_${selectedEntry.id}` : "journal";
                          saveAllScrollPositions(
                            tabScrollPositions.current,
                            leftPanelScrollRef.current?.scrollTop ?? null,
                            null,
                            storageKey
                          );
                        }}
                      >
                        <RichTextEditor
                          value={currentTrade.trade}
                          onChange={(content: string) => updateTradeFormData(activeTradeIndex, "trade", content)}
                          placeholder="Describe the related trades..."
                          readOnly={false}
                        />
                      </div>
                    )}
                    {activeTab === "what_went_well" && (
                      <div 
                        ref={(el) => { tabContentRefs.current.set("what_went_well", el); }}
                        style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto", minHeight: 0 }}
                        onScroll={(e) => { 
                          tabScrollPositions.current.set("what_went_well", e.currentTarget.scrollTop);
                          const storageKey = selectedEntry?.id ? `journal_entry_${selectedEntry.id}` : "journal";
                          saveAllScrollPositions(
                            tabScrollPositions.current,
                            leftPanelScrollRef.current?.scrollTop ?? null,
                            null,
                            storageKey
                          );
                        }}
                      >
                        <RichTextEditor
                          value={currentTrade.what_went_well}
                          onChange={(content: string) => updateTradeFormData(activeTradeIndex, "what_went_well", content)}
                          placeholder="What went well..."
                          readOnly={false}
                        />
                      </div>
                    )}
                    {activeTab === "what_could_be_improved" && (
                      <div 
                        ref={(el) => { tabContentRefs.current.set("what_could_be_improved", el); }}
                        style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto", minHeight: 0 }}
                        onScroll={(e) => { 
                          tabScrollPositions.current.set("what_could_be_improved", e.currentTarget.scrollTop);
                          const storageKey = selectedEntry?.id ? `journal_entry_${selectedEntry.id}` : "journal";
                          saveAllScrollPositions(
                            tabScrollPositions.current,
                            leftPanelScrollRef.current?.scrollTop ?? null,
                            null,
                            storageKey
                          );
                        }}
                      >
                        <RichTextEditor
                          value={currentTrade.what_could_be_improved}
                          onChange={(content: string) => updateTradeFormData(activeTradeIndex, "what_could_be_improved", content)}
                          placeholder="What could be improved..."
                          readOnly={false}
                        />
                      </div>
                    )}
                    {activeTab === "links" && (
                      <div
                        ref={(el) => { tabContentRefs.current.set("links", el); }}
                        style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto", minHeight: 0 }}
                        onScroll={(e) => {
                          tabScrollPositions.current.set("links", e.currentTarget.scrollTop);
                          const storageKey = selectedEntry?.id ? `journal_entry_${selectedEntry.id}` : "journal";
                          saveAllScrollPositions(
                            tabScrollPositions.current,
                            leftPanelScrollRef.current?.scrollTop ?? null,
                            null,
                            storageKey
                          );
                        }}
                      >
                        {!(isCreating || isEditing) ? (
                          <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Click <strong>Edit</strong> to manage links for this journal entry. You can also manage emotional state links from the <strong>Emotional State</strong> tab.</p>
                        ) : !selectedEntry?.id ? (
                          <>
                            <div style={{ marginBottom: "20px", padding: "16px", backgroundColor: "var(--bg-secondary)", borderRadius: "10px", border: "1px solid var(--border-color)" }}>
                              <h4 style={{ margin: "0 0 10px", fontSize: "13px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Emotions</h4>
                              <p style={{ margin: "0 0 12px", fontSize: "12px", color: "var(--text-secondary)" }}>Link this journal to emotional state entries. Links are saved when you save the journal entry.</p>
                              <div style={{ marginBottom: "16px" }}>
                                <h3 style={{ margin: "0 0 6px", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Link to</h3>
                                <p style={{ margin: "0 0 8px", fontSize: "12px", color: "var(--text-secondary)" }}>One emotional state per journal trade or one for the entire entry. This applies to the <strong>next</strong> state you link—change the selection before each link to associate different states with different trades.</p>
                                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                  <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px" }}>
                                    <input type="radio" name="linkExistingScope" checked={linkExistingEmotionalStateScope === "entry"} onChange={() => { setLinkExistingEmotionalStateScope("entry"); setLinkExistingEmotionalStateTradeIndex(null); }} />
                                    Entire journal entry
                                  </label>
                                  <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px" }}>
                                    <input type="radio" name="linkExistingScope" checked={linkExistingEmotionalStateScope === "trades"} onChange={() => setLinkExistingEmotionalStateScope("trades")} />
                                    Specific trade(s)
                                  </label>
                                  {linkExistingEmotionalStateScope === "trades" && (
                                    <div style={{ marginLeft: "24px", display: "flex", flexDirection: "column", gap: "4px", marginTop: "4px" }}>
                                      {tradesFormData.map((t, i) => (
                                        <label key={i} style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "12px" }}>
                                          <input type="radio" name="linkExistingTrade" checked={linkExistingEmotionalStateTradeIndex === i} onChange={() => setLinkExistingEmotionalStateTradeIndex(i)} />
                                          {t.symbol ? `${t.symbol}${t.position ? ` (${t.position})` : ""}` : `Trade ${i + 1}`}
                                        </label>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <label style={{ display: "block", marginBottom: "6px", fontSize: "12px", fontWeight: "600" }}>Link to emotional states</label>
                              {(entryFormData.linked_emotional_state_ids?.length ?? 0) > 0 && (
                                <ul style={{ listStyle: "none", padding: 0, margin: "0 0 10px" }}>
                                  {(entryFormData.linked_emotional_state_ids ?? []).map((stateId) => {
                                    const allGroups = groupEmotionalStatesByTimestamp(allEmotionalStates);
                                    const group = allGroups.find((g) => g.some((s) => s.id === stateId));
                                    const first = group?.[0];
                                    return first ? (
                                      <li key={first.timestamp} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", padding: "8px 10px", backgroundColor: "var(--bg-tertiary)", borderRadius: "6px", marginBottom: "6px" }}>
                                        <span style={{ fontSize: "13px", color: "var(--text-primary)" }}>
                                          {format(new Date(first.timestamp), "MMM d, yyyy HH:mm")} · {group!.map((s) => `${s.emotion} ${s.intensity}/10`).join(", ")}
                                        </span>
                                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                          <span style={{ fontSize: "11px", fontWeight: "600", color: "var(--accent)", padding: "2px 6px", backgroundColor: "var(--bg-hover)", borderRadius: "4px" }}>Will link on save</span>
                                          <button type="button" onClick={() => setEntryFormData((prev) => { const next = (prev.linked_emotional_state_ids ?? []).filter((id) => id !== stateId); const scopes = { ...(prev.linked_emotional_state_link_scopes ?? {}) }; delete scopes[stateId]; return { ...prev, linked_emotional_state_ids: next, linked_emotional_state_link_scopes: scopes }; })} style={{ padding: "4px 8px", fontSize: "11px", color: "var(--text-secondary)", background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", cursor: "pointer" }}>Remove</button>
                                        </div>
                                      </li>
                                    ) : null;
                                  })}
                                </ul>
                              )}
                              <div style={{ position: "relative" }} ref={journalLinksStateDropdownRef}>
                                <button type="button" onClick={() => setJournalLinksStateDropdownOpen((o) => !o)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", width: "100%", padding: "8px 12px", backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: "6px", color: "var(--text-primary)", fontSize: "13px", cursor: "pointer", textAlign: "left" }}>
                                  <span>Select emotional states to link...</span>
                                  <ChevronDown size={16} style={{ transform: journalLinksStateDropdownOpen ? "rotate(180deg)" : "none" }} />
                                </button>
                                {journalLinksStateDropdownOpen && (() => {
                                  const linkedIds = new Set(entryFormData.linked_emotional_state_ids ?? []);
                                  const allGroups = groupEmotionalStatesByTimestamp(allEmotionalStates);
                                  const addableGroups = allGroups.filter((g) => !linkedIds.has(g[0].id));
                                  const scope = { scope: linkExistingEmotionalStateScope, tradeIndex: linkExistingEmotionalStateScope === "trades" ? linkExistingEmotionalStateTradeIndex : null };
                                  return (
                                    <div style={{ position: "absolute", zIndex: 50, marginTop: "4px", maxHeight: "220px", overflowY: "auto", minWidth: "320px", backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "8px", boxShadow: "0 8px 24px rgba(0,0,0,0.2)", padding: "6px" }}>
                                      {addableGroups.length === 0 ? <div style={{ padding: "12px", fontSize: "13px", color: "var(--text-secondary)" }}>All emotional state entries are selected, or none exist.</div> : addableGroups.map((group) => {
                                        const first = group[0];
                                        return (
                                          <button key={first.timestamp} type="button" onClick={() => { setEntryFormData((prev) => ({ ...prev, linked_emotional_state_ids: [...(prev.linked_emotional_state_ids ?? []), first.id], linked_emotional_state_link_scopes: { ...(prev.linked_emotional_state_link_scopes ?? {}), [first.id]: scope } })); setJournalLinksStateDropdownOpen(false); }} style={{ display: "block", width: "100%", padding: "10px 12px", textAlign: "left", fontSize: "13px", color: "var(--text-primary)", background: "transparent", border: "none", borderRadius: "6px", cursor: "pointer" }} onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--bg-hover)"; }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}>
                                            {format(new Date(first.timestamp), "MMM d, yyyy HH:mm")} · {group.map((s) => `${s.emotion} ${s.intensity}/10`).join(", ")}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  );
                                })()}
                              </div>
                            </div>
                            <div style={{ padding: "16px", backgroundColor: "var(--bg-secondary)", borderRadius: "10px", border: "1px solid var(--border-color)" }}>
                              <h4 style={{ margin: "0 0 10px", fontSize: "13px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Trades</h4>
                              <p style={{ margin: "0 0 12px", fontSize: "12px", color: "var(--text-secondary)" }}>Link this journal to real trades. Links are saved when you save the journal entry.</p>
                              <label style={{ display: "block", marginBottom: "6px", fontSize: "12px", fontWeight: "600" }}>Link to real trades</label>
                              {(entryFormData.linked_trade_ids?.length ?? 0) > 0 && (
                                <ul style={{ listStyle: "none", padding: 0, margin: "0 0 10px" }}>
                                  {(entryFormData.linked_trade_ids ?? []).map((tradeId) => {
                                    const t = realTradesForLink.find((r) => r.id === tradeId);
                                    return (
                                      <li key={tradeId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", padding: "8px 10px", backgroundColor: "var(--bg-tertiary)", borderRadius: "6px", marginBottom: "6px" }}>
                                        <span style={{ fontSize: "13px", color: "var(--text-primary)" }}>{t ? `${t.symbol} ${t.side}${t.quantity ? ` · ${t.quantity}` : ""}${t.pnl != null && t.pnl !== 0 ? ` · PnL ${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}` : ""} · ${format(new Date(t.timestamp), "MMM dd, yyyy")}` : `Trade #${tradeId}`}</span>
                                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                          <span style={{ fontSize: "11px", fontWeight: "600", color: "var(--accent)", padding: "2px 6px", backgroundColor: "var(--bg-hover)", borderRadius: "4px" }}>Will link on save</span>
                                          <button type="button" onClick={() => setEntryFormData((prev) => ({ ...prev, linked_trade_ids: (prev.linked_trade_ids ?? []).filter((id) => id !== tradeId) }))} style={{ padding: "4px 8px", fontSize: "11px", color: "var(--text-secondary)", background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", cursor: "pointer" }}>Remove</button>
                                        </div>
                                      </li>
                                    );
                                  })}
                                </ul>
                              )}
                              <div style={{ position: "relative" }} ref={journalLinksTradeDropdownRef}>
                                <button type="button" onClick={() => setJournalLinksTradeDropdownOpen((o) => !o)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", width: "100%", padding: "8px 12px", backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: "6px", color: "var(--text-primary)", fontSize: "13px", cursor: "pointer", textAlign: "left" }}>
                                  <span>Select trades to link...</span>
                                  <ChevronDown size={16} style={{ transform: journalLinksTradeDropdownOpen ? "rotate(180deg)" : "none" }} />
                                </button>
                                {journalLinksTradeDropdownOpen && (
                                  <div style={{ position: "absolute", zIndex: 50, marginTop: "4px", maxHeight: "220px", overflowY: "auto", minWidth: "300px", backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "8px", boxShadow: "0 8px 24px rgba(0,0,0,0.2)", padding: "6px" }}>
                                    {realTradesForLink.map((t) => {
                                      const ids = entryFormData.linked_trade_ids ?? [];
                                      const isLinked = ids.includes(t.id);
                                      return (
                                        <button key={t.id} type="button" disabled={isLinked} onClick={() => { if (!isLinked) setEntryFormData((prev) => ({ ...prev, linked_trade_ids: [...(prev.linked_trade_ids ?? []), t.id] })); setJournalLinksTradeDropdownOpen(false); }} style={{ display: "block", width: "100%", padding: "8px 12px", textAlign: "left", fontSize: "13px", color: isLinked ? "var(--text-secondary)" : "var(--text-primary)", background: "transparent", border: "none", borderRadius: "6px", cursor: isLinked ? "default" : "pointer", opacity: isLinked ? 0.8 : 1 }} onMouseEnter={(e) => { if (!isLinked) e.currentTarget.style.backgroundColor = "var(--bg-hover)"; }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}>
                                          {t.symbol} {t.side}{t.quantity ? ` · ${t.quantity}` : ""}{t.pnl != null && t.pnl !== 0 ? ` · PnL ${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}` : ""} · {format(new Date(t.timestamp), "MMM dd, yyyy")}{isLinked && <span style={{ marginLeft: "8px", fontSize: "11px", color: "var(--accent)" }}>Selected</span>}
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                              <p style={{ margin: "8px 0 0", fontSize: "11px", color: "var(--text-secondary)" }}>Links are saved when you save the journal entry.</p>
                            </div>
                          </>
                        ) : (
                          <>
                            {/* Emotions — clear separation of link categories */}
                            <div style={{ marginBottom: "20px", padding: "16px", backgroundColor: "var(--bg-secondary)", borderRadius: "10px", border: "1px solid var(--border-color)" }}>
                              <h4 style={{ margin: "0 0 10px", fontSize: "13px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Emotions</h4>
                              <p style={{ margin: "0 0 12px", fontSize: "12px", color: "var(--text-secondary)" }}>Link this journal entry to emotional state entries.</p>
                              <div style={{ marginBottom: "16px" }}>
                                <h3 style={{ margin: "0 0 6px", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Link to</h3>
                                <p style={{ margin: "0 0 8px", fontSize: "12px", color: "var(--text-secondary)" }}>One emotional state per journal trade or one for the entire entry. This applies to the <strong>next</strong> state you link—change the selection before each link to associate different states with different trades.</p>
                                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                  <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px" }}>
                                    <input type="radio" name="linkExistingScopeLinksTab" checked={linkExistingEmotionalStateScope === "entry"} onChange={() => { setLinkExistingEmotionalStateScope("entry"); setLinkExistingEmotionalStateTradeIndex(null); }} />
                                    Entire journal entry
                                  </label>
                                  <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px" }}>
                                    <input type="radio" name="linkExistingScopeLinksTab" checked={linkExistingEmotionalStateScope === "trades"} onChange={() => setLinkExistingEmotionalStateScope("trades")} />
                                    Specific trade(s)
                                  </label>
                                  {linkExistingEmotionalStateScope === "trades" && (
                                    <div style={{ marginLeft: "24px", display: "flex", flexDirection: "column", gap: "4px", marginTop: "4px" }}>
                                      {tradesFormData.map((t, i) => (
                                        <label key={i} style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "12px" }}>
                                          <input type="radio" name="linkExistingTradeLinksTab" checked={linkExistingEmotionalStateTradeIndex === i} onChange={() => setLinkExistingEmotionalStateTradeIndex(i)} />
                                          {t.symbol ? `${t.symbol}${t.position ? ` (${t.position})` : ""}` : `Trade ${i + 1}`}
                                        </label>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <label style={{ display: "block", marginBottom: "6px", fontSize: "12px", fontWeight: "600" }}>Link to emotional states</label>
                              {groupEmotionalStatesByTimestamp(journalEmotionalStates).length > 0 && (
                                <ul style={{ listStyle: "none", padding: 0, margin: "0 0 10px" }}>
                                  {groupEmotionalStatesByTimestamp(journalEmotionalStates).map((group) => {
                                    const first = group[0];
                                    const scopeLabelLinks = first.journal_trade_id == null ? "Entire journal entry" : (() => { const idx = tradesFormData.findIndex((t) => t.id === first.journal_trade_id); return idx >= 0 ? `Trade ${idx + 1}` : "Trade"; })();
                                    return (
                                      <li key={first.timestamp} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", padding: "8px 10px", backgroundColor: "var(--bg-tertiary)", borderRadius: "6px", marginBottom: "6px" }}>
                                        <span style={{ fontSize: "13px", color: "var(--text-primary)" }}>
                                          {format(new Date(first.timestamp), "MMM d, yyyy HH:mm")} · {group.map((s) => `${s.emotion} ${s.intensity}/10`).join(", ")}
                                        </span>
                                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                          <span style={{ fontSize: "11px", fontWeight: "600", color: "var(--accent)", padding: "2px 6px", backgroundColor: "var(--bg-hover)", borderRadius: "4px" }} title={scopeLabelLinks}>Linked · {scopeLabelLinks}</span>
                                          <button
                                            type="button"
                                            onClick={async () => {
                                              try {
                                                await invoke("remove_journal_entry_from_emotional_states", { journalEntryId: selectedEntry!.id, emotionalStateIds: group.map((s) => s.id) });
                                                const states = await invoke<JournalEmotionalState[]>("get_emotional_states_for_journal", { journalEntryId: selectedEntry!.id });
                                                setJournalEmotionalStates(states);
                                                const groups = groupEmotionalStatesByTimestamp(states);
                                                const ids = groups.map((g) => g[0].id);
                                                const scopes: Record<number, { scope: "entry" | "trades"; tradeIndex: number | null }> = {};
                                                for (const g of groups) {
                                                  const f = g[0];
                                                  if (f.journal_trade_id == null) scopes[f.id] = { scope: "entry", tradeIndex: null };
                                                  else { const idx = tradesFormData.findIndex((t) => t.id === f.journal_trade_id); scopes[f.id] = { scope: "trades", tradeIndex: idx >= 0 ? idx : null }; }
                                                }
                                                setEntryFormData((prev) => ({ ...prev, linked_emotional_state_ids: ids, linked_emotional_state_link_scopes: scopes }));
                                              } catch (e) { console.error(e); }
                                            }}
                                            style={{ padding: "4px 8px", fontSize: "11px", color: "var(--text-secondary)", background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", cursor: "pointer" }}
                                          >Unlink</button>
                                          <button type="button" onClick={() => navigate("/emotions", { state: { openTimestamp: first.timestamp } })} style={{ padding: "4px 8px", fontSize: "11px", color: "var(--accent)", background: "transparent", border: "1px solid var(--accent)", borderRadius: "4px", cursor: "pointer" }}>Open in Emotions</button>
                                        </div>
                                      </li>
                                    );
                                  })}
                                </ul>
                              )}
                              <div style={{ position: "relative" }} ref={journalLinksStateDropdownRef}>
                                <button type="button" onClick={() => setJournalLinksStateDropdownOpen((o) => !o)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", width: "100%", padding: "8px 12px", backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: "6px", color: "var(--text-primary)", fontSize: "13px", cursor: "pointer", textAlign: "left" }}>
                                  <span>Add this journal to emotional states...</span>
                                  <ChevronDown size={16} style={{ transform: journalLinksStateDropdownOpen ? "rotate(180deg)" : "none" }} />
                                </button>
                                {journalLinksStateDropdownOpen && (() => {
                                  const linkedTimestamps = new Set(groupEmotionalStatesByTimestamp(journalEmotionalStates).map((g) => g[0].timestamp));
                                  const allGroups = groupEmotionalStatesByTimestamp(allEmotionalStates);
                                  const addableGroups = allGroups.filter((g) => !linkedTimestamps.has(g[0].timestamp));
                                  return (
                                    <div style={{ position: "absolute", zIndex: 50, marginTop: "4px", maxHeight: "220px", overflowY: "auto", minWidth: "320px", backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "8px", boxShadow: "0 8px 24px rgba(0,0,0,0.2)", padding: "6px" }}>
                                      {addableGroups.length === 0 ? <div style={{ padding: "12px", fontSize: "13px", color: "var(--text-secondary)" }}>All emotional state entries are already linked, or none exist.</div> : addableGroups.map((group) => {
                                        const first = group[0];
                                        return (
                                          <button
                                            key={first.timestamp}
                                            type="button"
                                            onClick={async () => {
                                              try {
                                                const ids = group.map((s) => s.id);
                                                await invoke("add_journal_entry_to_emotional_states", { journalEntryId: selectedEntry!.id, emotionalStateIds: ids });
                                                const jtId = linkExistingEmotionalStateScope === "entry" ? null : (linkExistingEmotionalStateTradeIndex != null ? tradesFormData[linkExistingEmotionalStateTradeIndex]?.id ?? null : null);
                                                await invoke("link_emotional_states_to_journal", { emotionalStateIds: ids, journalEntryId: selectedEntry!.id, journalTradeId: jtId ?? undefined });
                                                const states = await invoke<JournalEmotionalState[]>("get_emotional_states_for_journal", { journalEntryId: selectedEntry!.id });
                                                setJournalEmotionalStates(states);
                                                const grps = groupEmotionalStatesByTimestamp(states);
                                                const linkIds = grps.map((g) => g[0].id);
                                                const scopes: Record<number, { scope: "entry" | "trades"; tradeIndex: number | null }> = {};
                                                for (const grp of grps) {
                                                  const f = grp[0];
                                                  const idx = tradesFormData.findIndex((t) => t.id === f.journal_trade_id);
                                                  scopes[f.id] = f.journal_trade_id == null ? { scope: "entry", tradeIndex: null } : { scope: "trades", tradeIndex: idx >= 0 ? idx : null };
                                                }
                                                setEntryFormData((prev) => ({ ...prev, linked_emotional_state_ids: linkIds, linked_emotional_state_link_scopes: scopes }));
                                                setJournalLinksStateDropdownOpen(false);
                                              } catch (e) { console.error(e); }
                                            }}
                                            style={{ display: "block", width: "100%", padding: "10px 12px", textAlign: "left", fontSize: "13px", color: "var(--text-primary)", background: "transparent", border: "none", borderRadius: "6px", cursor: "pointer" }}
                                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--bg-hover)"; }}
                                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                                          >
                                            {format(new Date(first.timestamp), "MMM d, yyyy HH:mm")} · {group.map((s) => `${s.emotion} ${s.intensity}/10`).join(", ")}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  );
                                })()}
                              </div>
                            </div>
                            {/* Trades — clear separation of link categories */}
                            <div style={{ padding: "16px", backgroundColor: "var(--bg-secondary)", borderRadius: "10px", border: "1px solid var(--border-color)" }}>
                              <h4 style={{ margin: "0 0 10px", fontSize: "13px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Trades</h4>
                              <p style={{ margin: "0 0 12px", fontSize: "12px", color: "var(--text-secondary)" }}>Link this journal entry to real trades.</p>
                              <label style={{ display: "block", marginBottom: "6px", fontSize: "12px", fontWeight: "600" }}>Link to real trades</label>
                              {(entryFormData.linked_trade_ids?.length ?? 0) > 0 && (
                                <ul style={{ listStyle: "none", padding: 0, margin: "0 0 10px" }}>
                                  {(entryFormData.linked_trade_ids ?? []).map((tradeId) => {
                                    const t = realTradesForLink.find((r) => r.id === tradeId);
                                    return (
                                      <li key={tradeId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", padding: "8px 10px", backgroundColor: "var(--bg-tertiary)", borderRadius: "6px", marginBottom: "6px" }}>
                                        <span style={{ fontSize: "13px", color: "var(--text-primary)" }}>{t ? `${t.symbol} ${t.side}${t.quantity ? ` · ${t.quantity}` : ""}${t.pnl != null && t.pnl !== 0 ? ` · PnL ${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}` : ""} · ${format(new Date(t.timestamp), "MMM dd, yyyy")}` : `Trade #${tradeId}`}</span>
                                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                          <span style={{ fontSize: "11px", fontWeight: "600", color: "var(--accent)", padding: "2px 6px", backgroundColor: "var(--bg-hover)", borderRadius: "4px" }}>Linked</span>
                                          <button type="button" onClick={() => setEntryFormData((prev) => ({ ...prev, linked_trade_ids: (prev.linked_trade_ids ?? []).filter((id) => id !== tradeId) }))} style={{ padding: "4px 8px", fontSize: "11px", color: "var(--text-secondary)", background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", cursor: "pointer" }}>Unlink</button>
                                        </div>
                                      </li>
                                    );
                                  })}
                                </ul>
                              )}
                              <div style={{ position: "relative" }} ref={journalLinksTradeDropdownRef}>
                                <button type="button" onClick={() => setJournalLinksTradeDropdownOpen((o) => !o)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", width: "100%", padding: "8px 12px", backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: "6px", color: "var(--text-primary)", fontSize: "13px", cursor: "pointer", textAlign: "left" }}>
                                  <span>Select trades to link...</span>
                                  <ChevronDown size={16} style={{ transform: journalLinksTradeDropdownOpen ? "rotate(180deg)" : "none" }} />
                                </button>
                                {journalLinksTradeDropdownOpen && (
                                  <div style={{ position: "absolute", zIndex: 50, marginTop: "4px", maxHeight: "220px", overflowY: "auto", minWidth: "300px", backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "8px", boxShadow: "0 8px 24px rgba(0,0,0,0.2)", padding: "6px" }}>
                                    {realTradesForLink.map((t) => {
                                      const ids = entryFormData.linked_trade_ids ?? [];
                                      const isLinked = ids.includes(t.id);
                                      return (
                                        <button key={t.id} type="button" disabled={isLinked} onClick={() => { if (!isLinked) setEntryFormData((prev) => ({ ...prev, linked_trade_ids: [...(prev.linked_trade_ids ?? []), t.id] })); setJournalLinksTradeDropdownOpen(false); }} style={{ display: "block", width: "100%", padding: "8px 12px", textAlign: "left", fontSize: "13px", color: isLinked ? "var(--text-secondary)" : "var(--text-primary)", background: "transparent", border: "none", borderRadius: "6px", cursor: isLinked ? "default" : "pointer", opacity: isLinked ? 0.8 : 1 }} onMouseEnter={(e) => { if (!isLinked) e.currentTarget.style.backgroundColor = "var(--bg-hover)"; }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}>
                                          {t.symbol} {t.side}{t.quantity ? ` · ${t.quantity}` : ""}{t.pnl != null && t.pnl !== 0 ? ` · PnL ${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}` : ""} · {format(new Date(t.timestamp), "MMM dd, yyyy")}{isLinked && <span style={{ marginLeft: "8px", fontSize: "11px", color: "var(--accent)" }}>Linked</span>}
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                              <p style={{ margin: "8px 0 0", fontSize: "11px", color: "var(--text-secondary)" }}>Save the journal entry to persist linked trades.</p>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                    {activeTab === "emotional_state" && (
                      <div 
                        ref={(el) => { tabContentRefs.current.set("emotional_state", el); }}
                        style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto", minHeight: 0 }}
                        onScroll={(e) => { 
                          tabScrollPositions.current.set("emotional_state", e.currentTarget.scrollTop);
                          const storageKey = selectedEntry?.id ? `journal_entry_${selectedEntry.id}` : "journal";
                          saveAllScrollPositions(
                            tabScrollPositions.current,
                            leftPanelScrollRef.current?.scrollTop ?? null,
                            null,
                            storageKey
                          );
                        }}
                      >
                        {(isCreating || isEditing) ? (
                          <>
                            {/* Single "Link to" scope for both linking existing states and adding new ones */}
                            <div style={{ marginBottom: "20px", padding: "16px", backgroundColor: "var(--bg-secondary)", borderRadius: "10px", border: "1px solid var(--border-color)" }}>
                              <h3 style={{ margin: "0 0 6px", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Link to</h3>
                              <p style={{ margin: "0 0 10px", fontSize: "12px", color: "var(--text-secondary)" }}>One emotional state per journal trade or one for the entire entry. The choice below applies to the <strong>next</strong> state you link or add—change it before each action to link different states to different trades (e.g. one state for Trade 1, another for Trade 2).</p>
                              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                                <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px" }}>
                                  <input
                                    type="radio"
                                    name="emotionalStateTabLinkScope"
                                    checked={newEmotionalStateLinkScope === "entry"}
                                    onChange={() => {
                                      setNewEmotionalStateLinkScope("entry");
                                      setNewEmotionalStateTradeIndices([]);
                                      setLinkExistingEmotionalStateScope("entry");
                                      setLinkExistingEmotionalStateTradeIndex(null);
                                    }}
                                  />
                                  Entire journal entry
                                </label>
                                <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px" }}>
                                  <input
                                    type="radio"
                                    name="emotionalStateTabLinkScope"
                                    checked={newEmotionalStateLinkScope === "trades"}
                                    onChange={() => { setNewEmotionalStateLinkScope("trades"); setLinkExistingEmotionalStateScope("trades"); }}
                                  />
                                  Specific trade(s)
                                </label>
                                {newEmotionalStateLinkScope === "trades" && (
                                  <div style={{ marginLeft: "24px", display: "flex", flexWrap: "wrap", gap: "10px", marginTop: "6px" }}>
                                    {tradesFormData.map((t, i) => {
                                      const label = t.symbol ? `${t.symbol}${t.position ? ` (${t.position})` : ""}` : `Trade ${i + 1}`;
                                      const checked = newEmotionalStateTradeIndices.includes(i);
                                      return (
                                        <label key={i} style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "12px" }}>
                                          <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={() => {
                                              const next = checked ? newEmotionalStateTradeIndices.filter((j) => j !== i) : [...newEmotionalStateTradeIndices, i];
                                              setNewEmotionalStateTradeIndices(next);
                                              setLinkExistingEmotionalStateTradeIndex(next[0] ?? null);
                                            }}
                                          />
                                          {label || `Trade ${i + 1}`}
                                        </label>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Link to emotional states only (trades are linked from the Links tab) */}
                            <div style={{ marginBottom: "20px", padding: "16px", backgroundColor: "var(--bg-secondary)", borderRadius: "10px", border: "1px solid var(--border-color)" }}>
                              <h4 style={{ margin: "0 0 14px", fontSize: "13px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Link to emotional states</h4>
                              {selectedEntry?.id ? (
                                <>
                                  <p style={{ margin: "0 0 16px", fontSize: "12px", color: "var(--text-secondary)" }}>Link this journal entry to emotional state entries. Already linked items are shown below. You can also manage links from the <strong>Links</strong> tab.</p>
                                  <div style={{ marginBottom: "0" }}>
                                <label style={{ display: "block", marginBottom: "4px", fontSize: "12px", fontWeight: "600" }}>Link to emotional states</label>
                                <p style={{ margin: "0 0 8px", fontSize: "11px", color: "var(--text-secondary)" }}>Each row shows whether the state is linked to the entire journal entry or to a specific trade.</p>
                                {groupEmotionalStatesByTimestamp(journalEmotionalStates).length > 0 && (
                                  <ul style={{ listStyle: "none", padding: 0, margin: "0 0 10px" }}>
                                    {groupEmotionalStatesByTimestamp(journalEmotionalStates).map((group) => {
                                      const first = group[0];
                                      const scopeLabel = first.journal_trade_id == null ? "Entire journal entry" : (() => { const idx = tradesFormData.findIndex((t) => t.id === first.journal_trade_id); return idx >= 0 ? `Trade ${idx + 1}` : "Trade"; })();
                                      return (
                                        <li key={first.timestamp} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", padding: "8px 10px", backgroundColor: "var(--bg-tertiary)", borderRadius: "6px", marginBottom: "6px" }}>
                                          <span style={{ fontSize: "13px", color: "var(--text-primary)" }}>
                                            {format(new Date(first.timestamp), "MMM d, yyyy HH:mm")} · {group.map((s) => `${s.emotion} ${s.intensity}/10`).join(", ")}
                                          </span>
                                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                            <span style={{ fontSize: "11px", fontWeight: "600", color: "var(--accent)", padding: "2px 6px", backgroundColor: "var(--bg-hover)", borderRadius: "4px" }} title={scopeLabel}>Linked · {scopeLabel}</span>
                                            <button
                                              type="button"
                                              onClick={async () => {
                                                try {
                                                  await invoke("remove_journal_entry_from_emotional_states", { journalEntryId: selectedEntry!.id, emotionalStateIds: group.map((s) => s.id) });
                                                  const states = await invoke<JournalEmotionalState[]>("get_emotional_states_for_journal", { journalEntryId: selectedEntry!.id });
                                                  setJournalEmotionalStates(states);
                                                  const groups = groupEmotionalStatesByTimestamp(states);
                                                  const ids = groups.map((g) => g[0].id);
                                                  const scopes: Record<number, { scope: "entry" | "trades"; tradeIndex: number | null }> = {};
                                                  for (const g of groups) {
                                                    const first = g[0];
                                                    if (first.journal_trade_id == null) {
                                                      scopes[first.id] = { scope: "entry", tradeIndex: null };
                                                    } else {
                                                      const idx = tradesFormData.findIndex((t) => t.id === first.journal_trade_id);
                                                      scopes[first.id] = { scope: "trades", tradeIndex: idx >= 0 ? idx : null };
                                                    }
                                                  }
                                                  setEntryFormData((prev) => ({ ...prev, linked_emotional_state_ids: ids, linked_emotional_state_link_scopes: scopes }));
                                                } catch (e) {
                                                  console.error(e);
                                                }
                                              }}
                                              style={{ padding: "4px 8px", fontSize: "11px", color: "var(--text-secondary)", background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", cursor: "pointer" }}
                                            >
                                              Unlink
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => navigate("/emotions", { state: { openTimestamp: first.timestamp } })}
                                              style={{ padding: "4px 8px", fontSize: "11px", color: "var(--accent)", background: "transparent", border: "1px solid var(--accent)", borderRadius: "4px", cursor: "pointer" }}
                                            >
                                              Open in Emotions
                                            </button>
                                          </div>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                )}
                                <div style={{ position: "relative" }} ref={journalLinksStateDropdownRef}>
                                  <button
                                    type="button"
                                    onClick={() => setJournalLinksStateDropdownOpen((o) => !o)}
                                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", width: "100%", padding: "8px 12px", backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: "6px", color: "var(--text-primary)", fontSize: "13px", cursor: "pointer", textAlign: "left" }}
                                  >
                                    <span>Add this journal to emotional states...</span>
                                    <ChevronDown size={16} style={{ transform: journalLinksStateDropdownOpen ? "rotate(180deg)" : "none" }} />
                                  </button>
                                  {journalLinksStateDropdownOpen && (() => {
                                    const linkedTimestamps = new Set(groupEmotionalStatesByTimestamp(journalEmotionalStates).map((g) => g[0].timestamp));
                                    const allGroups = groupEmotionalStatesByTimestamp(allEmotionalStates);
                                    const addableGroups = allGroups.filter((g) => !linkedTimestamps.has(g[0].timestamp));
                                    return (
                                      <div style={{ position: "absolute", zIndex: 50, marginTop: "4px", maxHeight: "220px", overflowY: "auto", minWidth: "320px", backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "8px", boxShadow: "0 8px 24px rgba(0,0,0,0.2)", padding: "6px" }}>
                                        {addableGroups.length === 0 ? (
                                          <div style={{ padding: "12px", fontSize: "13px", color: "var(--text-secondary)" }}>All emotional state entries are already linked, or none exist.</div>
                                        ) : (
                                          addableGroups.map((group) => {
                                            const first = group[0];
                                            return (
                                              <button
                                                key={first.timestamp}
                                                type="button"
                                                onClick={async () => {
                                                  try {
                                                    const ids = group.map((s) => s.id);
                                                    await invoke("add_journal_entry_to_emotional_states", { journalEntryId: selectedEntry!.id, emotionalStateIds: ids });
                                                    const jtId = linkExistingEmotionalStateScope === "entry" ? null : (linkExistingEmotionalStateTradeIndex != null ? tradesFormData[linkExistingEmotionalStateTradeIndex]?.id ?? null : null);
                                                    await invoke("link_emotional_states_to_journal", { emotionalStateIds: ids, journalEntryId: selectedEntry!.id, journalTradeId: jtId ?? undefined });
                                                    const states = await invoke<JournalEmotionalState[]>("get_emotional_states_for_journal", { journalEntryId: selectedEntry!.id });
                                                    setJournalEmotionalStates(states);
                                                    const groups = groupEmotionalStatesByTimestamp(states);
                                                    const linkIds = groups.map((g) => g[0].id);
                                                    const scopes: Record<number, { scope: "entry" | "trades"; tradeIndex: number | null }> = {};
                                                    for (const grp of groups) {
                                                      const f = grp[0];
                                                      const idx = tradesFormData.findIndex((t) => t.id === f.journal_trade_id);
                                                      scopes[f.id] = f.journal_trade_id == null ? { scope: "entry", tradeIndex: null } : { scope: "trades", tradeIndex: idx >= 0 ? idx : null };
                                                    }
                                                    setEntryFormData((prev) => ({ ...prev, linked_emotional_state_ids: linkIds, linked_emotional_state_link_scopes: scopes }));
                                                    setJournalLinksStateDropdownOpen(false);
                                                  } catch (e) {
                                                    console.error(e);
                                                  }
                                                }}
                                                style={{ display: "block", width: "100%", padding: "10px 12px", textAlign: "left", fontSize: "13px", color: "var(--text-primary)", background: "transparent", border: "none", borderRadius: "6px", cursor: "pointer" }}
                                                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--bg-hover)"; }}
                                                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                                              >
                                                {format(new Date(first.timestamp), "MMM d, yyyy HH:mm")} · {group.map((s) => `${s.emotion} ${s.intensity}/10`).join(", ")}
                                              </button>
                                            );
                                          })
                                        )}
                                      </div>
                                    );
                                  })()}
                                </div>
                              </div>

                                </>
                              ) : (
                                <>
                                  <p style={{ margin: "0 0 12px", fontSize: "12px", color: "var(--text-secondary)" }}>You can link this journal to emotional state entries below. Links are saved when you save the journal entry.</p>
                                  <div style={{ marginBottom: "16px" }}>
                                    <label style={{ display: "block", marginBottom: "6px", fontSize: "12px", fontWeight: "600" }}>Link to emotional states</label>
                                    {(entryFormData.linked_emotional_state_ids?.length ?? 0) > 0 && (
                                      <ul style={{ listStyle: "none", padding: 0, margin: "0 0 10px" }}>
                                        {(entryFormData.linked_emotional_state_ids ?? []).map((stateId) => {
                                          const allGroups = groupEmotionalStatesByTimestamp(allEmotionalStates);
                                          const group = allGroups.find((g) => g.some((s) => s.id === stateId));
                                          const first = group?.[0];
                                          const scopeForPending = entryFormData.linked_emotional_state_link_scopes?.[stateId];
                                          const scopeLabelPending = scopeForPending?.scope === "entry" ? "Entire journal entry" : (scopeForPending?.tradeIndex != null ? `Trade ${scopeForPending.tradeIndex + 1}` : "—");
                                          return first ? (
                                            <li key={first.timestamp} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", padding: "8px 10px", backgroundColor: "var(--bg-tertiary)", borderRadius: "6px", marginBottom: "6px" }}>
                                              <span style={{ fontSize: "13px", color: "var(--text-primary)" }}>
                                                {format(new Date(first.timestamp), "MMM d, yyyy HH:mm")} · {group!.map((s) => `${s.emotion} ${s.intensity}/10`).join(", ")}
                                              </span>
                                              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                                <span style={{ fontSize: "11px", fontWeight: "600", color: "var(--accent)", padding: "2px 6px", backgroundColor: "var(--bg-hover)", borderRadius: "4px" }}>Will link on save · {scopeLabelPending}</span>
                                                <button type="button" onClick={() => setEntryFormData((prev) => { const next = (prev.linked_emotional_state_ids ?? []).filter((id) => id !== stateId); const scopes = { ...(prev.linked_emotional_state_link_scopes ?? {}) }; delete scopes[stateId]; return { ...prev, linked_emotional_state_ids: next, linked_emotional_state_link_scopes: scopes }; })} style={{ padding: "4px 8px", fontSize: "11px", color: "var(--text-secondary)", background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", cursor: "pointer" }}>Remove</button>
                                              </div>
                                            </li>
                                          ) : null;
                                        })}
                                      </ul>
                                    )}
                                    <div style={{ position: "relative" }} ref={journalLinksStateDropdownRef}>
                                      <button type="button" onClick={() => setJournalLinksStateDropdownOpen((o) => !o)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", width: "100%", padding: "8px 12px", backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: "6px", color: "var(--text-primary)", fontSize: "13px", cursor: "pointer", textAlign: "left" }}>
                                        <span>Select emotional states to link...</span>
                                        <ChevronDown size={16} style={{ transform: journalLinksStateDropdownOpen ? "rotate(180deg)" : "none" }} />
                                      </button>
                                      {journalLinksStateDropdownOpen && (() => {
                                        const linkedIds = new Set(entryFormData.linked_emotional_state_ids ?? []);
                                        const allGroups = groupEmotionalStatesByTimestamp(allEmotionalStates);
                                        const addableGroups = allGroups.filter((g) => !linkedIds.has(g[0].id));
                                        const scope = { scope: linkExistingEmotionalStateScope, tradeIndex: linkExistingEmotionalStateScope === "trades" ? linkExistingEmotionalStateTradeIndex : null };
                                        return (
                                          <div style={{ position: "absolute", zIndex: 50, marginTop: "4px", maxHeight: "220px", overflowY: "auto", minWidth: "320px", backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "8px", boxShadow: "0 8px 24px rgba(0,0,0,0.2)", padding: "6px" }}>
                                            {addableGroups.length === 0 ? <div style={{ padding: "12px", fontSize: "13px", color: "var(--text-secondary)" }}>All emotional state entries are selected, or none exist.</div> : addableGroups.map((group) => {
                                              const first = group[0];
                                              return (
                                                <button key={first.timestamp} type="button" onClick={() => { setEntryFormData((prev) => ({ ...prev, linked_emotional_state_ids: [...(prev.linked_emotional_state_ids ?? []), first.id], linked_emotional_state_link_scopes: { ...(prev.linked_emotional_state_link_scopes ?? {}), [first.id]: scope } })); setJournalLinksStateDropdownOpen(false); }} style={{ display: "block", width: "100%", padding: "10px 12px", textAlign: "left", fontSize: "13px", color: "var(--text-primary)", background: "transparent", border: "none", borderRadius: "6px", cursor: "pointer" }} onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--bg-hover)"; }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}>
                                                  {format(new Date(first.timestamp), "MMM d, yyyy HH:mm")} · {group.map((s) => `${s.emotion} ${s.intensity}/10`).join(", ")}
                                                </button>
                                              );
                                            })}
                                          </div>
                                        );
                                      })()}
                                    </div>
                                  </div>
                                </>
                              )}
                            </div>

                            <div style={{ marginBottom: "16px" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                                <span style={{ fontSize: "14px", fontWeight: "600", color: "var(--text-primary)" }}>Emotional states</span>
                                {!showAddEmotionalStateForm && (
                                  <button
                                    type="button"
                                    onClick={() => setShowAddEmotionalStateForm(true)}
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: "6px",
                                      padding: "8px 14px",
                                      background: "var(--accent)",
                                      border: "none",
                                      borderRadius: "6px",
                                      color: "white",
                                      fontSize: "13px",
                                      cursor: "pointer",
                                    }}
                                  >
                                    <Plus size={14} />
                                    Add State
                                  </button>
                                )}
                              </div>
                              {(journalEmotionalStates.length === 0 && pendingEmotionalStates.filter((p) => p.tradeIndex === activeTradeIndex || p.tradeIndex === -1).length === 0 && !showAddEmotionalStateForm) && (
                                <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>No emotional states linked. Add one with the same form as on the Emotions page.</p>
                              )}
                              {/* When editing an existing entry, linked states are shown in "Link to emotional states" above; only show them here when creating (no selectedEntry.id) */}
                              {!selectedEntry?.id && groupEmotionalStatesByTimestamp(journalEmotionalStates).map((group) => {
                                const first = group[0];
                                const notes = first.notes;
                                return (
                                  <div
                                    key={first.timestamp}
                                    style={{
                                      padding: "12px",
                                      backgroundColor: "var(--bg-tertiary)",
                                      border: "1px solid var(--border-color)",
                                      borderRadius: "6px",
                                      marginBottom: "8px",
                                    }}
                                  >
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px", flexWrap: "wrap", gap: "8px" }}>
                                      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}>
                                        {group.map((s) => (
                                          <span key={s.id} style={{ fontWeight: "600", color: "var(--text-primary)", fontSize: "13px" }}>
                                            {s.emotion} {s.intensity}/10
                                          </span>
                                        ))}
                                      </div>
                                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                        <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                                          {format(new Date(first.timestamp), "MMM d, yyyy HH:mm")}
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() => setEmotionalStateDeleteTarget({ type: "saved", states: group })}
                                          style={{ padding: "2px 6px", background: "transparent", border: "none", borderRadius: "4px", color: "var(--text-secondary)", cursor: "pointer", fontSize: "12px" }}
                                          title="Delete"
                                        >
                                          <Trash2 size={14} />
                                        </button>
                                      </div>
                                    </div>
                                    {notes && (
                                      <div style={{ fontSize: "13px", color: "var(--text-secondary)" }} dangerouslySetInnerHTML={{ __html: notes }} />
                                    )}
                                  </div>
                                );
                              })}
                              {pendingEmotionalStates.filter((p) => p.tradeIndex === activeTradeIndex || p.tradeIndex === -1).map((pending, idx) => (
                                <div
                                  key={`pending-${activeTradeIndex}-${idx}`}
                                  style={{
                                    padding: "12px",
                                    backgroundColor: "var(--bg-tertiary)",
                                    border: "1px solid var(--border-color)",
                                    borderRadius: "6px",
                                    marginBottom: "8px",
                                  }}
                                >
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px", flexWrap: "wrap", gap: "8px" }}>
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}>
                                      {Object.entries(pending.selectedEmotions).map(([emotion, intensity]) => (
                                        <span key={emotion} style={{ fontWeight: "600", color: "var(--text-primary)", fontSize: "13px" }}>
                                          {emotion} {intensity}/10
                                        </span>
                                      ))}
                                    </div>
                                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                      <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                                        {pending.tradeIndex === -1 ? "Entire journal entry (unsaved)" : `Trade ${pending.tradeIndex + 1} (unsaved)`}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setPendingEmotionalStates((prev) => prev.filter((p) => p !== pending));
                                          setNewEmotionalStateForm({ selectedEmotions: { ...pending.selectedEmotions }, notes: pending.notes });
                                          setNewEmotionalStateLinkScope(pending.tradeIndex === -1 ? "entry" : "trades");
                                          setNewEmotionalStateTradeIndices(pending.tradeIndex === -1 ? [] : [pending.tradeIndex]);
                                          setShowAddEmotionalStateForm(true);
                                        }}
                                        style={{ padding: "2px 6px", background: "transparent", border: "none", borderRadius: "4px", color: "var(--accent)", cursor: "pointer", fontSize: "12px" }}
                                        title="Edit"
                                      >
                                        <Edit2 size={14} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                        const sameScope = pendingEmotionalStates.filter((p) => p.tradeIndex === pending.tradeIndex);
                                        const scopeIdx = sameScope.indexOf(pending);
                                        setEmotionalStateDeleteTarget({ type: "pending", tradeIndex: pending.tradeIndex, idx: scopeIdx });
                                      }}
                                        style={{ padding: "2px 6px", background: "transparent", border: "none", borderRadius: "4px", color: "var(--text-secondary)", cursor: "pointer", fontSize: "12px" }}
                                        title="Remove"
                                      >
                                        <X size={14} />
                                      </button>
                                    </div>
                                  </div>
                                  {pending.notes && (
                                    <div style={{ fontSize: "13px", color: "var(--text-secondary)" }} dangerouslySetInnerHTML={{ __html: pending.notes }} />
                                  )}
                                </div>
                              ))}
                            </div>
                            {((journalEmotionalStates.length === 0 && pendingEmotionalStates.filter((p) => p.tradeIndex === activeTradeIndex || p.tradeIndex === -1).length === 0) || showAddEmotionalStateForm) && (
                              <div style={{ padding: "20px", backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "12px", marginBottom: "16px" }}>
                                <h4 style={{ margin: "0 0 16px", fontSize: "14px", fontWeight: "600" }}>Add emotional state</h4>
                                <div style={{ marginBottom: "20px", padding: "12px 14px", backgroundColor: "var(--bg-tertiary)", borderRadius: "10px", border: "1px solid var(--border-color)" }}>
                                  <p style={{ margin: 0, fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.5 }}>{INTENSITY_SCALE_LABEL}</p>
                                </div>
                                <p style={{ margin: "0 0 12px", fontSize: "12px", color: "var(--text-secondary)" }}>
                                  Add this emotional state to the journal entry using the button below. Save the journal entry when done to persist everything.
                                </p>
                                <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", alignItems: "center", marginBottom: "20px" }}>
                                  <button
                                    type="button"
                                    disabled={
                                      Object.keys(newEmotionalStateForm.selectedEmotions).length === 0 ||
                                      (newEmotionalStateLinkScope === "trades" && newEmotionalStateTradeIndices.length === 0)
                                    }
                                    onClick={async () => {
                                      const hasAny = Object.keys(newEmotionalStateForm.selectedEmotions).length > 0;
                                      if (!hasAny) return;
                                      if (newEmotionalStateLinkScope === "trades" && newEmotionalStateTradeIndices.length === 0) return;
                                      const entryId = selectedEntry?.id;
                                      const savedEntry = entryId != null;
                                      if (savedEntry) {
                                        try {
                                          const now = new Date().toISOString();
                                          const allStates = await invoke<JournalEmotionalState[]>("get_emotional_states_for_journal", { journalEntryId: entryId! });
                                          const deleteGroup = async (group: JournalEmotionalState[]) => {
                                            for (const s of group) {
                                              await invoke("delete_emotional_state", { id: s.id });
                                            }
                                          };
                                          if (newEmotionalStateLinkScope === "entry") {
                                            const entryLevel = allStates.filter((s) => s.journal_trade_id == null);
                                            const groups = groupEmotionalStatesByTimestamp(entryLevel);
                                            for (const g of groups) await deleteGroup(g);
                                            for (const emotion of Object.keys(newEmotionalStateForm.selectedEmotions)) {
                                              await invoke("add_emotional_state", {
                                                timestamp: now,
                                                emotion,
                                                intensity: newEmotionalStateForm.selectedEmotions[emotion],
                                                notes: newEmotionalStateForm.notes || null,
                                                tradeId: null,
                                                journalEntryId: entryId,
                                                journalTradeId: null,
                                              });
                                            }
                                          } else {
                                            for (const tradeIdx of newEmotionalStateTradeIndices) {
                                              const trade = tradesFormData[tradeIdx];
                                              const jtId = trade?.id ?? null;
                                              if (jtId == null) continue;
                                              const forTrade = allStates.filter((s) => s.journal_trade_id === jtId);
                                              const groups = groupEmotionalStatesByTimestamp(forTrade);
                                              for (const g of groups) await deleteGroup(g);
                                              for (const emotion of Object.keys(newEmotionalStateForm.selectedEmotions)) {
                                                await invoke("add_emotional_state", {
                                                  timestamp: now,
                                                  emotion,
                                                  intensity: newEmotionalStateForm.selectedEmotions[emotion],
                                                  notes: newEmotionalStateForm.notes || null,
                                                  tradeId: null,
                                                  journalEntryId: entryId,
                                                  journalTradeId: jtId,
                                                });
                                              }
                                            }
                                          }
                                          const states = await invoke<JournalEmotionalState[]>("get_emotional_states_for_journal", { journalEntryId: entryId! });
                                          setJournalEmotionalStates(states);
                                          setNewEmotionalStateForm({ selectedEmotions: {}, notes: "" });
                                          setNewEmotionalStateLinkScope("entry");
                                          setNewEmotionalStateTradeIndices([]);
                                          setShowAddEmotionalStateForm(false);
                                        } catch (e) {
                                          console.error(e);
                                        }
                                      } else {
                                        if (newEmotionalStateLinkScope === "entry") {
                                          setPendingEmotionalStates((prev) => prev.filter((p) => p.tradeIndex !== -1).concat([{ tradeIndex: -1, selectedEmotions: newEmotionalStateForm.selectedEmotions, notes: newEmotionalStateForm.notes }]));
                                        } else {
                                          let next = pendingEmotionalStates.filter((p) => p.tradeIndex === -1 || !newEmotionalStateTradeIndices.includes(p.tradeIndex));
                                          for (const i of newEmotionalStateTradeIndices) {
                                            next = next.filter((p) => p.tradeIndex !== i);
                                            next.push({ tradeIndex: i, selectedEmotions: newEmotionalStateForm.selectedEmotions, notes: newEmotionalStateForm.notes });
                                          }
                                          setPendingEmotionalStates(next);
                                        }
                                        setNewEmotionalStateForm({ selectedEmotions: {}, notes: "" });
                                        setNewEmotionalStateLinkScope("entry");
                                        setNewEmotionalStateTradeIndices([]);
                                        setShowAddEmotionalStateForm(false);
                                      }
                                    }}
                                    style={{
                                      padding: "8px 16px",
                                      background: "var(--accent)",
                                      border: "none",
                                      borderRadius: "6px",
                                      color: "white",
                                      cursor: Object.keys(newEmotionalStateForm.selectedEmotions).length === 0 ? "not-allowed" : "pointer",
                                      fontSize: "13px",
                                      fontWeight: "600",
                                      opacity: Object.keys(newEmotionalStateForm.selectedEmotions).length === 0 ? 0.6 : 1,
                                    }}
                                    title="Add this emotional state to the journal entry"
                                  >
                                    Add emotional state to entry
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => { setShowAddEmotionalStateForm(false); setNewEmotionalStateForm({ selectedEmotions: {}, notes: "" }); setNewEmotionalStateLinkScope("entry"); setNewEmotionalStateTradeIndices([]); }}
                                    style={{ padding: "6px 12px", background: "transparent", border: "none", borderRadius: "6px", color: "var(--text-secondary)", cursor: "pointer", fontSize: "13px" }}
                                  >
                                    Close
                                  </button>
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                                  <div>
                                    <h3 style={{ margin: "0 0 4px", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Emotions</h3>
                                    <p style={{ margin: "0 0 10px", fontSize: "12px", color: "var(--text-secondary)" }}>Tap to add or remove; then set strength below.</p>
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                                      {JOURNAL_EMOTIONS.map((emotion) => {
                                        const intensity = newEmotionalStateForm.selectedEmotions[emotion];
                                        const isSelected = intensity !== undefined;
                                        return (
                                          <button
                                            key={emotion}
                                            type="button"
                                            onClick={() => {
                                              if (isSelected) {
                                                const next = { ...newEmotionalStateForm.selectedEmotions };
                                                delete next[emotion];
                                                setNewEmotionalStateForm((f) => ({ ...f, selectedEmotions: next }));
                                              } else {
                                                setNewEmotionalStateForm((f) => ({
                                                  ...f,
                                                  selectedEmotions: { ...f.selectedEmotions, [emotion]: DEFAULT_EMOTION_INTENSITY },
                                                }));
                                              }
                                            }}
                                            style={{
                                              padding: "8px 14px",
                                              borderRadius: "999px",
                                              border: `1px solid ${isSelected ? "var(--accent)" : "var(--border-color)"}`,
                                              backgroundColor: isSelected ? "var(--bg-hover)" : "var(--bg-tertiary)",
                                              color: "var(--text-primary)",
                                              fontSize: "12px",
                                              fontWeight: isSelected ? "600" : "500",
                                              cursor: "pointer",
                                              boxShadow: isSelected ? "0 0 0 1px var(--accent)" : "none",
                                            }}
                                          >
                                            {emotion}
                                            {isSelected && <span style={{ marginLeft: "4px", opacity: 0.9 }}>{intensity}/10</span>}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                  {Object.keys(newEmotionalStateForm.selectedEmotions).length > 0 && (
                                    <div style={{ padding: "16px", backgroundColor: "var(--bg-tertiary)", borderRadius: "12px", border: "1px solid var(--border-color)" }}>
                                      <h3 style={{ margin: "0 0 4px", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Set intensity</h3>
                                      <div style={{ marginBottom: "12px", display: "flex", alignItems: "center", gap: "8px", fontSize: "11px", color: "var(--text-secondary)" }}>
                                        <span>0</span>
                                        <div style={{ flex: 1, height: "2px", background: "var(--border-color)", borderRadius: 1 }} />
                                        <span>10</span>
                                        <span style={{ marginLeft: "4px" }}>← strength</span>
                                      </div>
                                      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                                        {Object.entries(newEmotionalStateForm.selectedEmotions).map(([emotion, intensity]) => (
                                          <div key={emotion} style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", padding: "8px 0", borderBottom: "1px solid var(--border-color)" }}>
                                            <span style={{ minWidth: "88px", fontSize: "13px", fontWeight: "500" }}>{emotion}</span>
                                            <input
                                              type="range"
                                              min={0}
                                              max={10}
                                              value={intensity}
                                              onChange={(e) =>
                                                setNewEmotionalStateForm((f) => ({
                                                  ...f,
                                                  selectedEmotions: { ...f.selectedEmotions, [emotion]: parseInt(e.target.value, 10) },
                                                }))
                                              }
                                              style={{ flex: "1", minWidth: "100px", maxWidth: "220px", height: "6px", accentColor: "var(--accent)" }}
                                            />
                                            <span style={{ fontSize: "13px", fontWeight: "600", color: "var(--accent)", minWidth: "28px" }}>{intensity}/10</span>
                                            <span style={{ fontSize: "12px", color: "var(--text-secondary)", minWidth: "64px" }}>{INTENSITY_LABELS[intensity]}</span>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                const next = { ...newEmotionalStateForm.selectedEmotions };
                                                delete next[emotion];
                                                setNewEmotionalStateForm((f) => ({ ...f, selectedEmotions: next }));
                                              }}
                                              style={{ padding: "4px 10px", background: "transparent", color: "var(--text-secondary)", border: "1px solid var(--border-color)", borderRadius: "6px", cursor: "pointer", fontSize: "11px" }}
                                            >
                                              Remove
                                            </button>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  <div>
                                    <h3 style={{ margin: "0 0 6px", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Notes (for this whole entry)</h3>
                                    <RichTextEditor
                                      value={newEmotionalStateForm.notes}
                                      onChange={(content: string) => setNewEmotionalStateForm((f) => ({ ...f, notes: content }))}
                                      placeholder="Notes..."
                                      readOnly={false}
                                    />
                                  </div>
                                </div>
                              </div>
                            )}
                          </>
                        ) : (
                          <div>
                            <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
                              Create or open a journal entry to add emotional states (same as the Emotions page).
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                    {activeTab === "notes" && (
                      <div 
                        ref={(el) => { tabContentRefs.current.set("notes", el); }}
                        style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto", minHeight: 0 }}
                        onScroll={(e) => { 
                          tabScrollPositions.current.set("notes", e.currentTarget.scrollTop);
                          const storageKey = selectedEntry?.id ? `journal_entry_${selectedEntry.id}` : "journal";
                          saveAllScrollPositions(
                            tabScrollPositions.current,
                            leftPanelScrollRef.current?.scrollTop ?? null,
                            null,
                            storageKey
                          );
                        }}
                      >
                        <RichTextEditor
                          value={currentTrade.notes}
                          onChange={(content: string) => updateTradeFormData(activeTradeIndex, "notes", content)}
                          placeholder="Notes..."
                          readOnly={false}
                        />
                      </div>
                    )}
                    {activeTab === "checklists" && (
                      <div 
                        ref={(el) => { tabContentRefs.current.set("checklists", el); }}
                        style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto", minHeight: 0 }}
                        onScroll={(e) => { 
                          tabScrollPositions.current.set("checklists", e.currentTarget.scrollTop);
                          const storageKey = selectedEntry?.id ? `journal_entry_${selectedEntry.id}` : "journal";
                          saveAllScrollPositions(
                            tabScrollPositions.current,
                            leftPanelScrollRef.current?.scrollTop ?? null,
                            null,
                            storageKey
                          );
                        }}
                      >
                        {entryFormData.strategy_id && currentChecklists ? (
                          <div style={{ overflowY: "auto" }}>
                            {allTypes.map((type) => {
                              const items = currentChecklists.get(type) || [];
                              if (items.length === 0) return null;

                              const isEntryLevel = ENTRY_LEVEL_CHECKLIST_TYPES.includes(type);
                              const responses = isEntryLevel ? entryLevelChecklistResponses : (checklistResponses.get(activeTradeIndex) || new Map());
                              // Entry-level: show actual stored state so checkbox is always clickable; association is shown via "Whole entry" / "N trade(s)" label
                              const getChecked = (id: number) => responses.get(id) || false;
                              const onToggle = isEntryLevel ? (id: number) => toggleEntryLevelChecklistItem(id) : (id: number) => toggleChecklistItem(activeTradeIndex, id);

                              // Organize items: groups and regular items
                              const groups = items.filter(item => !item.parent_id && items.some(child => child.parent_id === item.id));
                              const regularItems = items.filter(item => !item.parent_id && !items.some(child => child.parent_id === item.id));
                              const groupedItems = items.filter(item => item.parent_id !== null && items.some(p => p.id === item.parent_id));
                              const itemsByParent = new Map<number, ChecklistItem[]>();
                              groupedItems.forEach(item => {
                                if (item.parent_id) {
                                  const parentId = item.parent_id;
                                  if (!itemsByParent.has(parentId)) itemsByParent.set(parentId, []);
                                  itemsByParent.get(parentId)!.push(item);
                                }
                              });

                              return (
                                <div key={type} style={{ marginBottom: "24px" }}>
                                  <h4 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "12px", color: "var(--text-primary)" }}>
                                    {getChecklistTitle(type)}
                                    {isEntryLevel && (
                                      <span style={{ fontSize: "11px", fontWeight: "400", color: "var(--text-secondary)", marginLeft: "8px" }}>
                                        (applies to whole journal by default)
                                      </span>
                                    )}
                                  </h4>
                                  {groups.map((group) => {
                                    const children = itemsByParent.get(group.id) || [];
                                    return (
                                      <div key={group.id} style={{ marginBottom: "16px" }}>
                                        <div style={{ padding: "12px", backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: "6px", marginBottom: "8px", fontWeight: "600", color: "var(--text-primary)" }}>
                                          {group.item_text}
                                        </div>
                                        {children.map((child) => (
                                          <div key={child.id} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px", marginLeft: "20px", marginBottom: "4px" }}>
                                            <input type="checkbox" checked={getChecked(child.id)} onChange={() => onToggle(child.id)} style={{ cursor: "pointer", width: "16px", height: "16px" }} />
                                            <label style={{ flex: 1, fontSize: "14px", color: "var(--text-primary)", cursor: "pointer" }} onClick={() => onToggle(child.id)}>{child.item_text}</label>
                                            {isEntryLevel && entryTradesForAssociation.length > 1 && (
                                              <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                                                <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                                                  {!(checklistTradeAssociations.get(child.id)?.length) ? "Whole entry" : `${checklistTradeAssociations.get(child.id)!.length} trade(s)`}
                                                </span>
                                                <button type="button" onClick={() => setTradeAssociationModalItemId(child.id)} style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: "4px", display: "flex" }} title="Associate with specific trades">
                                                  <Link2 size={14} />
                                                </button>
                                              </span>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    );
                                  })}
                                  {regularItems.map((item) => (
                                    <div key={item.id} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px", marginBottom: "4px", backgroundColor: "var(--bg-tertiary)", borderRadius: "6px" }}>
                                      <input type="checkbox" checked={getChecked(item.id)} onChange={() => onToggle(item.id)} style={{ cursor: "pointer", width: "16px", height: "16px" }} />
                                      <label style={{ flex: 1, fontSize: "14px", color: "var(--text-primary)", cursor: "pointer" }} onClick={() => onToggle(item.id)}>{item.item_text}</label>
                                      {isEntryLevel && entryTradesForAssociation.length > 1 && (
                                        <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                                          <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                                            {!(checklistTradeAssociations.get(item.id)?.length) ? "Whole entry" : `${checklistTradeAssociations.get(item.id)!.length} trade(s)`}
                                          </span>
                                          <button type="button" onClick={() => setTradeAssociationModalItemId(item.id)} style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: "4px", display: "flex" }} title="Associate with specific trades">
                                            <Link2 size={14} />
                                          </button>
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              );
                            })}
                            {/* Trade association modal */}
                            {tradeAssociationModalItemId !== null && (
                              <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setTradeAssociationModalItemId(null)}>
                                <div style={{ background: "var(--bg-primary)", borderRadius: "8px", padding: "20px", maxWidth: "400px", width: "90%", border: "1px solid var(--border-color)" }} onClick={e => e.stopPropagation()}>
                                  <h4 style={{ margin: "0 0 12px", fontSize: "14px" }}>Associate with trades</h4>
                                  <p style={{ margin: "0 0 12px", fontSize: "12px", color: "var(--text-secondary)" }}>By default this applies to the whole journal. Optionally link to specific <strong>journal trades</strong> in this entry ({entryTradesForAssociation.length}):</p>
                                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "16px" }}>
                                    <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                                      <input type="checkbox" checked={!(checklistTradeAssociations.get(tradeAssociationModalItemId)?.length)} onChange={() => setChecklistTradeAssociation(tradeAssociationModalItemId, null)} />
                                      <span>Whole entry (default)</span>
                                    </label>
                                    <div style={{ maxHeight: "240px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "6px", paddingRight: "4px" }}>
                                      {entryTradesForAssociation.map((t, i) => {
                                        const key: number = selectedEntry && (t as { id?: number }).id != null ? (t as { id: number }).id : i;
                                        const label = (t as { symbol?: string }).symbol || `Trade ${i + 1}`;
                                        const currentAssoc = checklistTradeAssociations.get(tradeAssociationModalItemId);
                                        const isSelected = !!currentAssoc && currentAssoc.length > 0 && currentAssoc.includes(key);
                                        const toggleTrade = () => {
                                          const prev = checklistTradeAssociations.get(tradeAssociationModalItemId) || [];
                                          const ids = prev.length > 0 ? [...prev] : [];
                                          const idx = ids.indexOf(key);
                                          if (idx >= 0) ids.splice(idx, 1);
                                          else ids.push(key);
                                          setChecklistTradeAssociation(tradeAssociationModalItemId, ids.length > 0 ? ids : null);
                                        };
                                        return (
                                          <label key={i} style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", flexShrink: 0 }}>
                                            <input type="checkbox" checked={isSelected} onChange={toggleTrade} />
                                            <span>{label}</span>
                                          </label>
                                        );
                                      })}
                                    </div>
                                  </div>
                                  <button onClick={() => setTradeAssociationModalItemId(null)} style={{ padding: "8px 16px", background: "var(--accent)", border: "none", borderRadius: "6px", color: "white", cursor: "pointer" }}>Done</button>
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div style={{ 
                            display: "flex", 
                            alignItems: "center", 
                            justifyContent: "center", 
                            height: "100%",
                            color: "var(--text-secondary)",
                            fontSize: "14px"
                          }}>
                            {entryFormData.strategy_id ? "No checklists available for this strategy." : "Select a strategy to view checklists."}
                          </div>
                        )}
                      </div>
                    )}
                    {activeTab === "survey" && (
                      <div 
                        ref={(el) => { tabContentRefs.current.set("survey", el); }}
                        style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto", minHeight: 0 }}
                        onScroll={(e) => { 
                          tabScrollPositions.current.set("survey", e.currentTarget.scrollTop);
                          const storageKey = selectedEntry?.id ? `journal_entry_${selectedEntry.id}` : "journal";
                          saveAllScrollPositions(
                            tabScrollPositions.current,
                            leftPanelScrollRef.current?.scrollTop ?? null,
                            null,
                            storageKey
                          );
                        }}
                      >
                        {entryFormData.strategy_id && currentChecklists ? (
                          <div style={{ overflowY: "auto" }}>
                            {(() => {
                              const surveyItems = currentChecklists.get("survey") || [];
                              if (surveyItems.length === 0) {
                                return (
                                  <div style={{ 
                                    display: "flex", 
                                    alignItems: "center", 
                                    justifyContent: "center", 
                                    height: "100%",
                                    color: "var(--text-secondary)",
                                    fontSize: "14px"
                                  }}>
                                    {entryFormData.strategy_id ? "No survey items available for this strategy." : "Select a strategy to view survey."}
                                  </div>
                                );
                              }

                              // Organize items: groups and regular items
                              const groups = surveyItems.filter(item => !item.parent_id && surveyItems.some(child => child.parent_id === item.id));
                              const regularItems = surveyItems.filter(item => !item.parent_id && !surveyItems.some(child => child.parent_id === item.id));
                              const groupedItems = surveyItems.filter(item => item.parent_id !== null && surveyItems.some(p => p.id === item.parent_id));
                              const itemsByParent = new Map<number, ChecklistItem[]>();
                              groupedItems.forEach(item => {
                                if (item.parent_id) {
                                  const parentId = item.parent_id;
                                  if (!itemsByParent.has(parentId)) {
                                    itemsByParent.set(parentId, []);
                                  }
                                  itemsByParent.get(parentId)!.push(item);
                                }
                              });

                              const tradeResponses = checklistResponses.get(activeTradeIndex) || new Map();

                              return (
                                <div style={{ marginBottom: "24px" }}>
                                  <h4 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "12px", color: "var(--text-primary)" }}>
                                    Post-Trade Survey
                                  </h4>
                                  {/* Render groups */}
                                  {groups.map((group) => {
                                    const children = itemsByParent.get(group.id) || [];
                                    return (
                                      <div key={group.id} style={{ marginBottom: "16px" }}>
                                        <div
                                          style={{
                                            padding: "12px",
                                            backgroundColor: "var(--bg-tertiary)",
                                            border: "1px solid var(--border-color)",
                                            borderRadius: "6px",
                                            marginBottom: "8px",
                                            fontWeight: "600",
                                            color: "var(--text-primary)",
                                          }}
                                        >
                                          {group.item_text}
                                        </div>
                                        {children.map((child) => {
                                          const response = tradeResponses.get(child.id);
                                          const isYes = response === true;
                                          const isNo = response === false;
                                          return (
                                            <div
                                              key={child.id}
                                              style={{
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "space-between",
                                                gap: "12px",
                                                padding: "12px",
                                                marginLeft: "20px",
                                                marginBottom: "8px",
                                                backgroundColor: "var(--bg-tertiary)",
                                                borderRadius: "6px",
                                              }}
                                            >
                                              <label
                                                style={{
                                                  flex: 1,
                                                  fontSize: "14px",
                                                  color: "var(--text-primary)",
                                                }}
                                              >
                                                {child.item_text}
                                              </label>
                                              <div style={{ display: "flex", gap: "8px" }}>
                                                <button
                                                  onClick={() => {
                                                    setChecklistResponses(prev => {
                                                      const newMap = new Map(prev);
                                                      const tradeResponses = new Map(newMap.get(activeTradeIndex) || new Map());
                                                      tradeResponses.set(child.id, true);
                                                      newMap.set(activeTradeIndex, tradeResponses);
                                                      return newMap;
                                                    });
                                                  }}
                                                  style={{
                                                    padding: "6px 16px",
                                                    backgroundColor: isYes ? "var(--accent)" : "var(--bg-secondary)",
                                                    border: `1px solid ${isYes ? "var(--accent)" : "var(--border-color)"}`,
                                                    borderRadius: "6px",
                                                    color: isYes ? "white" : "var(--text-primary)",
                                                    cursor: "pointer",
                                                    fontSize: "13px",
                                                    fontWeight: "500",
                                                    transition: "all 0.2s",
                                                  }}
                                                >
                                                  Yes
                                                </button>
                                                <button
                                                  onClick={() => {
                                                    setChecklistResponses(prev => {
                                                      const newMap = new Map(prev);
                                                      const tradeResponses = new Map(newMap.get(activeTradeIndex) || new Map());
                                                      tradeResponses.set(child.id, false);
                                                      newMap.set(activeTradeIndex, tradeResponses);
                                                      return newMap;
                                                    });
                                                  }}
                                                  style={{
                                                    padding: "6px 16px",
                                                    backgroundColor: isNo ? "var(--accent)" : "var(--bg-secondary)",
                                                    border: `1px solid ${isNo ? "var(--accent)" : "var(--border-color)"}`,
                                                    borderRadius: "6px",
                                                    color: isNo ? "white" : "var(--text-primary)",
                                                    cursor: "pointer",
                                                    fontSize: "13px",
                                                    fontWeight: "500",
                                                    transition: "all 0.2s",
                                                  }}
                                                >
                                                  No
                                                </button>
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    );
                                  })}
                                  {/* Render regular items */}
                                  {regularItems.map((item) => {
                                    const response = tradeResponses.get(item.id);
                                    const isYes = response === true;
                                    const isNo = response === false;
                                    return (
                                      <div
                                        key={item.id}
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          justifyContent: "space-between",
                                          gap: "12px",
                                          padding: "12px",
                                          marginBottom: "8px",
                                          backgroundColor: "var(--bg-tertiary)",
                                          borderRadius: "6px",
                                        }}
                                      >
                                        <label
                                          style={{
                                            flex: 1,
                                            fontSize: "14px",
                                            color: "var(--text-primary)",
                                          }}
                                        >
                                          {item.item_text}
                                        </label>
                                        <div style={{ display: "flex", gap: "8px" }}>
                                          <button
                                            onClick={() => {
                                              setChecklistResponses(prev => {
                                                const newMap = new Map(prev);
                                                const tradeResponses = new Map(newMap.get(activeTradeIndex) || new Map());
                                                tradeResponses.set(item.id, true);
                                                newMap.set(activeTradeIndex, tradeResponses);
                                                return newMap;
                                              });
                                            }}
                                            style={{
                                              padding: "6px 16px",
                                              backgroundColor: isYes ? "var(--accent)" : "var(--bg-secondary)",
                                              border: `1px solid ${isYes ? "var(--accent)" : "var(--border-color)"}`,
                                              borderRadius: "6px",
                                              color: isYes ? "white" : "var(--text-primary)",
                                              cursor: "pointer",
                                              fontSize: "13px",
                                              fontWeight: "500",
                                              transition: "all 0.2s",
                                            }}
                                          >
                                            Yes
                                          </button>
                                          <button
                                            onClick={() => {
                                              setChecklistResponses(prev => {
                                                const newMap = new Map(prev);
                                                const tradeResponses = new Map(newMap.get(activeTradeIndex) || new Map());
                                                tradeResponses.set(item.id, false);
                                                newMap.set(activeTradeIndex, tradeResponses);
                                                return newMap;
                                              });
                                            }}
                                            style={{
                                              padding: "6px 16px",
                                              backgroundColor: isNo ? "var(--accent)" : "var(--bg-secondary)",
                                              border: `1px solid ${isNo ? "var(--accent)" : "var(--border-color)"}`,
                                              borderRadius: "6px",
                                              color: isNo ? "white" : "var(--text-primary)",
                                              cursor: "pointer",
                                              fontSize: "13px",
                                              fontWeight: "500",
                                              transition: "all 0.2s",
                                            }}
                                          >
                                            No
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })()}
                          </div>
                        ) : (
                          <div style={{ 
                            display: "flex", 
                            alignItems: "center", 
                            justifyContent: "center", 
                            height: "100%",
                            color: "var(--text-secondary)",
                            fontSize: "14px"
                          }}>
                            {entryFormData.strategy_id ? "No survey items available for this strategy." : "Select a strategy to view survey."}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                </>
              )}
            </div>
          </>
        ) : (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-secondary)",
            }}
          >
            <div style={{ textAlign: "center" }}>
              <FileText size={48} style={{ margin: "0 auto 16px", opacity: 0.3 }} />
              <p style={{ fontSize: "16px" }}>Select an entry to view details</p>
            </div>
          </div>
        )}
      </div>

      {/* Right Panel - Entry List */}
      <div
        style={{
          width: isMaximized ? "0" : "300px",
          borderLeft: isMaximized ? "none" : "1px solid var(--border-color)",
          display: isMaximized ? "none" : "flex",
          flexDirection: "column",
          backgroundColor: "var(--bg-secondary)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--border-color)",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          <h1 style={{ fontSize: "20px", fontWeight: "bold" }}>Entries</h1>
          {!loading && entries.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
                <select
                  value={journalEntriesSort}
                  onChange={(e) => {
                    setJournalEntriesSort(e.target.value as "newest" | "oldest");
                    setJournalEntriesPage(1);
                  }}
                  style={{
                    padding: "6px 10px",
                    fontSize: "12px",
                    backgroundColor: "var(--bg-tertiary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "6px",
                    color: "var(--text-primary)",
                    cursor: "pointer",
                  }}
                >
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                </select>
                {journalEntriesTotalPages > 1 && (
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--text-secondary)" }}>
                    <button
                      type="button"
                      onClick={() => setJournalEntriesPage((p) => Math.max(1, p - 1))}
                      disabled={effectiveJournalPage <= 1}
                      style={{
                        padding: "4px 10px",
                        fontSize: "12px",
                        fontWeight: "600",
                        color: journalEntriesPage <= 1 ? "var(--text-secondary)" : "var(--accent)",
                        background: "transparent",
                        border: `1px solid ${journalEntriesPage <= 1 ? "var(--border-color)" : "var(--accent)"}`,
                        borderRadius: "6px",
                        cursor: journalEntriesPage <= 1 ? "default" : "pointer",
                        opacity: journalEntriesPage <= 1 ? 0.6 : 1,
                      }}
                    >
                      Prev
                    </button>
                    <span style={{ minWidth: "52px", textAlign: "center" }}>
                      {effectiveJournalPage} / {journalEntriesTotalPages}
                    </span>
                    <button
                      type="button"
                      onClick={() => setJournalEntriesPage((p) => Math.min(journalEntriesTotalPages, p + 1))}
                      disabled={effectiveJournalPage >= journalEntriesTotalPages}
                      style={{
                        padding: "4px 10px",
                        fontSize: "12px",
                        fontWeight: "600",
                        color: effectiveJournalPage >= journalEntriesTotalPages ? "var(--text-secondary)" : "var(--accent)",
                        background: "transparent",
                        border: `1px solid ${effectiveJournalPage >= journalEntriesTotalPages ? "var(--border-color)" : "var(--accent)"}`,
                        borderRadius: "6px",
                        cursor: effectiveJournalPage >= journalEntriesTotalPages ? "default" : "pointer",
                        opacity: effectiveJournalPage >= journalEntriesTotalPages ? 0.6 : 1,
                      }}
                    >
                      Next
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <div ref={leftPanelScrollRef} style={{ flex: 1, overflowY: "auto", padding: "12px" }}>
          {loading ? (
            <p style={{ color: "var(--text-secondary)", textAlign: "center", padding: "20px" }}>
              Loading...
            </p>
          ) : entries.length === 0 ? (
            <div
              style={{
                backgroundColor: "var(--bg-tertiary)",
                border: "1px solid var(--border-color)",
                borderRadius: "6px",
                padding: "30px",
                textAlign: "center",
              }}
            >
              <FileText size={32} style={{ margin: "0 auto 12px", opacity: 0.5 }} />
              <p style={{ color: "var(--text-secondary)", fontSize: "13px" }}>
                No journal entries yet. Create your first entry.
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {paginatedJournalEntries.map((entry) => {
                const isSelected = selectedEntry?.id === entry.id;
                return (
                  <div
                    key={entry.id}
                    onClick={() => {
                      // Save scroll position before switching (for previous entry if any)
                      if (selectedEntry?.id) {
                        const prevStorageKey = `journal_entry_${selectedEntry.id}`;
                        saveAllScrollPositions(
                          tabScrollPositions.current,
                          leftPanelScrollRef.current?.scrollTop ?? null,
                          null,
                          prevStorageKey
                        );
                      }
                      clearWorkInProgress(); // Clear work in progress when selecting an existing entry
                      // Save selected entry ID immediately
                      localStorage.setItem('journal_selected_entry_id', entry.id.toString());
                      // Clear tab scroll positions to load fresh for new entry
                      tabScrollPositions.current.clear();
                      loadEntry(entry.id);
                      setIsCreating(false);
                      setIsEditing(false);
                    }}
                    style={{
                      padding: "12px",
                      backgroundColor: isSelected ? "var(--accent)" : "var(--bg-tertiary)",
                      border: `1px solid ${isSelected ? "var(--accent)" : "var(--border-color)"}`,
                      borderRadius: "6px",
                      cursor: "pointer",
                      transition: "all 0.2s",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "14px",
                        fontWeight: "600",
                        color: isSelected ? "white" : "var(--text-primary)",
                        marginBottom: "4px",
                      }}
                    >
                      {format(parse(entry.date, "yyyy-MM-dd", new Date()), "MM/dd/yyyy")} - {entry.title}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Bottom Controls */}
        <div style={{ padding: "16px", borderTop: "1px solid var(--border-color)" }}>
          {/* Progress Bars */}
          {(isCreating || isEditing) && entryFormData.strategy_id && currentTrade && (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "12px" }}>
              {/* Analysis & Mantra (first) */}
              {(["daily_analysis", "daily_mantra"] as const).map((type) => {
                const items = currentChecklists?.get(type) || [];
                if (items.length === 0) return null;
                const progress = calculateChecklistProgress(activeTradeIndex, type);
                const getProgressColor = () => {
                  if (progress >= 80) return "var(--profit)";
                  if (progress >= 60) return "var(--accent)";
                  if (progress >= 40) return "var(--warning)";
                  return "var(--danger)";
                };
                return (
                  <div key={type}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                      <span style={{ fontSize: "12px", color: "var(--text-secondary)", fontWeight: "500" }}>
                        {getChecklistTitle(type)}
                      </span>
                      <span style={{ fontSize: "12px", color: getProgressColor(), fontWeight: "600" }}>{progress}%</span>
                    </div>
                    <div
                      style={{
                        width: "100%",
                        height: "8px",
                        backgroundColor: "var(--bg-tertiary)",
                        borderRadius: "4px",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${progress}%`,
                          height: "100%",
                          backgroundColor: getProgressColor(),
                          transition: "width 0.3s",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
              
              {/* Entry Probability */}
              {(() => {
                const entryItems = currentChecklists?.get("entry") || [];
                if (entryItems.length > 0) {
                  const entryProb = calculateEntryProbability(activeTradeIndex);
                  const getEntryColor = () => {
                    if (entryProb >= 80) return "var(--profit)";
                    if (entryProb >= 60) return "var(--accent)";
                    if (entryProb >= 40) return "var(--warning)";
                    return "var(--danger)";
                  };
                  return (
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                        <span style={{ fontSize: "12px", color: "var(--text-secondary)", fontWeight: "500" }}>Entry Probability</span>
                        <span style={{ fontSize: "12px", color: getEntryColor(), fontWeight: "600" }}>{entryProb}%</span>
                      </div>
                      <div
                        style={{
                          width: "100%",
                          height: "8px",
                          backgroundColor: "var(--bg-tertiary)",
                          borderRadius: "4px",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            width: `${entryProb}%`,
                            height: "100%",
                            backgroundColor: getEntryColor(),
                            transition: "width 0.3s",
                          }}
                        />
                      </div>
                    </div>
                  );
                }
                return null;
              })()}
              
              {/* Take Profit Implementation */}
              {(() => {
                const takeProfitItems = currentChecklists?.get("take_profit") || [];
                if (takeProfitItems.length > 0) {
                  const tpImpl = calculateTakeProfitImplementation(activeTradeIndex);
                  const getTPColor = () => {
                    if (tpImpl >= 80) return "var(--profit)";
                    if (tpImpl >= 60) return "var(--accent)";
                    if (tpImpl >= 40) return "var(--warning)";
                    return "var(--danger)";
                  };
                  return (
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                        <span style={{ fontSize: "12px", color: "var(--text-secondary)", fontWeight: "500" }}>Take Profit Implementation</span>
                        <span style={{ fontSize: "12px", color: getTPColor(), fontWeight: "600" }}>{tpImpl}%</span>
                      </div>
                      <div
                        style={{
                          width: "100%",
                          height: "8px",
                          backgroundColor: "var(--bg-tertiary)",
                          borderRadius: "4px",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            width: `${tpImpl}%`,
                            height: "100%",
                            backgroundColor: getTPColor(),
                            transition: "width 0.3s",
                          }}
                        />
                      </div>
                    </div>
                  );
                }
                return null;
              })()}
              
              {/* Custom Checklist Progress Bars */}
              {customTypes.map((type) => {
                const items = currentChecklists?.get(type) || [];
                if (items.length === 0) return null;
                
                const progress = calculateChecklistProgress(activeTradeIndex, type);
                const getProgressColor = () => {
                  if (progress >= 80) return "var(--profit)";
                  if (progress >= 60) return "var(--accent)";
                  if (progress >= 40) return "var(--warning)";
                  return "var(--danger)";
                };
                
                return (
                  <div key={type}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                      <span style={{ fontSize: "12px", color: "var(--text-secondary)", fontWeight: "500" }}>
                        {getChecklistTitle(type)}
                      </span>
                      <span style={{ fontSize: "12px", color: getProgressColor(), fontWeight: "600" }}>{progress}%</span>
                    </div>
                    <div
                      style={{
                        width: "100%",
                        height: "8px",
                        backgroundColor: "var(--bg-tertiary)",
                        borderRadius: "4px",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${progress}%`,
                          height: "100%",
                          backgroundColor: getProgressColor(),
                          transition: "width 0.3s",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <button
              onClick={handleCreateNew}
              style={{
                width: "100%",
                padding: "10px",
                backgroundColor: "var(--accent)",
                border: "none",
                borderRadius: "6px",
                color: "white",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px",
                fontSize: "14px",
                fontWeight: "500",
              }}
            >
              <Plus size={16} />
              Add Entry
            </button>
          </div>
        </div>
      </div>

      {/* Link to actual trades modal (journal trade -> real trades from Trades table) */}
      {linkActualTradesModalJournalTradeId !== null && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1001,
          }}
          onClick={() => setLinkActualTradesModalJournalTradeId(null)}
        >
          <div
            style={{
              background: "var(--bg-primary)",
              borderRadius: "8px",
              padding: "20px",
              maxWidth: "480px",
              width: "90%",
              maxHeight: "80vh",
              display: "flex",
              flexDirection: "column",
              border: "1px solid var(--border-color)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h4 style={{ margin: "0 0 8px", fontSize: "16px" }}>Link to actual trades</h4>
            <p style={{ margin: "0 0 12px", fontSize: "12px", color: "var(--text-secondary)" }}>
              Select real trades from your Trades list to associate with this journal trade.
            </p>
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: "6px", marginBottom: "16px", paddingRight: "4px" }}>
              {actualTrades.filter((t): t is ActualTrade & { id: number } => t.id != null).map((t) => {
                const tid = t.id as number;
                const isSelected = linkActualTradesSelection.includes(tid);
                return (
                  <label
                    key={tid}
                    style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", flexShrink: 0 }}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {
                        setLinkActualTradesSelection((prev) =>
                          prev.includes(tid) ? prev.filter((id) => id !== tid) : [...prev, tid]
                        );
                      }}
                    />
                    <span style={{ fontSize: "13px", color: "var(--text-primary)" }}>
                      {t.symbol} {t.side} · {t.quantity} @ ${typeof t.price === "number" ? t.price.toFixed(2) : t.price} · {t.timestamp ? format(new Date(t.timestamp), "MMM d, yyyy HH:mm") : ""}
                    </span>
                  </label>
                );
              })}
              {actualTrades.length === 0 && (
                <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>No actual trades in your Trades list. Add trades on the Trades page first.</span>
              )}
            </div>
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setLinkActualTradesModalJournalTradeId(null)}
                style={{ padding: "8px 16px", background: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: "6px", color: "var(--text-primary)", cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const jtId = linkActualTradesModalJournalTradeId;
                  if (jtId == null) return;
                  try {
                    await invoke("save_journal_trade_actual_trades", { journalTradeId: jtId, tradeIds: linkActualTradesSelection });
                    setJournalTradeActualTradeIds((prev) => new Map(prev).set(jtId, linkActualTradesSelection));
                  } catch (e) {
                    console.error(e);
                  }
                  setLinkActualTradesModalJournalTradeId(null);
                }}
                style={{ padding: "8px 16px", background: "var(--accent)", border: "none", borderRadius: "6px", color: "white", cursor: "pointer" }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirmModal && selectedEntry && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={handleDeleteCancel}
        >
          <div
            style={{
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "12px",
              padding: "24px",
              width: "90%",
              maxWidth: "450px",
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              style={{
                fontSize: "18px",
                fontWeight: "600",
                marginBottom: "12px",
                color: "var(--danger)",
              }}
            >
              Delete Journal Entry
            </h3>
            <p
              style={{
                fontSize: "14px",
                color: "var(--text-primary)",
                marginBottom: "8px",
                lineHeight: "1.5",
              }}
            >
              Are you sure you want to delete <strong>"{selectedEntry.title}"</strong>?
            </p>
            <p
              style={{
                fontSize: "13px",
                color: "var(--text-secondary)",
                marginBottom: "20px",
                lineHeight: "1.5",
              }}
            >
              This action cannot be undone. All trades, checklist responses, and notes associated with this journal entry will be permanently deleted.
            </p>
            <div
              style={{
                display: "flex",
                gap: "12px",
                justifyContent: "flex-end",
              }}
            >
              <button
                onClick={handleDeleteCancel}
                style={{
                  background: "var(--bg-tertiary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px",
                  padding: "10px 20px",
                  color: "var(--text-primary)",
                  cursor: "pointer",
                  fontSize: "14px",
                  fontWeight: "500",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                style={{
                  background: "var(--danger)",
                  border: "none",
                  borderRadius: "6px",
                  padding: "10px 20px",
                  color: "white",
                  cursor: "pointer",
                  fontSize: "14px",
                  fontWeight: "500",
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Emotional State Confirmation Modal */}
      {emotionalStateDeleteTarget && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={handleEmotionalStateDeleteCancel}
        >
          <div
            style={{
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "12px",
              padding: "24px",
              width: "90%",
              maxWidth: "450px",
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              style={{
                fontSize: "18px",
                fontWeight: "600",
                marginBottom: "12px",
                color: "var(--danger)",
              }}
            >
              Delete Emotional State
            </h3>
            <p
              style={{
                fontSize: "14px",
                color: "var(--text-primary)",
                marginBottom: "8px",
                lineHeight: "1.5",
              }}
            >
              Are you sure you want to delete this emotional state entry
              {emotionalStateDeleteTarget.type === "saved"
                ? ` (${emotionalStateDeleteTarget.states.map((s) => s.emotion).join(", ")})`
                : (() => {
                    const pendingList = pendingEmotionalStates.filter((p) => p.tradeIndex === emotionalStateDeleteTarget.tradeIndex);
                    const entry = pendingList[emotionalStateDeleteTarget.idx];
                    return entry ? ` (${Object.keys(entry.selectedEmotions).join(", ")})` : "";
                  })()}
              ?
            </p>
            <p
              style={{
                fontSize: "13px",
                color: "var(--text-secondary)",
                marginBottom: "20px",
                lineHeight: "1.5",
              }}
            >
              {emotionalStateDeleteTarget.type === "pending"
                ? "This entry has not been saved yet. It will be removed from the list."
                : "This action cannot be undone. The emotional state entry will be permanently deleted."}
            </p>
            <div
              style={{
                display: "flex",
                gap: "12px",
                justifyContent: "flex-end",
              }}
            >
              <button
                onClick={handleEmotionalStateDeleteCancel}
                style={{
                  background: "var(--bg-tertiary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px",
                  padding: "10px 20px",
                  color: "var(--text-primary)",
                  cursor: "pointer",
                  fontSize: "14px",
                  fontWeight: "500",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleEmotionalStateDeleteConfirm}
                style={{
                  background: "var(--danger)",
                  border: "none",
                  borderRadius: "6px",
                  padding: "10px 20px",
                  color: "white",
                  cursor: "pointer",
                  fontSize: "14px",
                  fontWeight: "500",
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Title Required Modal */}
      {showTitleRequiredModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setShowTitleRequiredModal(false)}
        >
          <div
            style={{
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "12px",
              padding: "24px",
              width: "90%",
              maxWidth: "400px",
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              style={{
                fontSize: "18px",
                fontWeight: "600",
                marginBottom: "12px",
                color: "var(--text-primary)",
              }}
            >
              Journal Entry Title Required
            </h3>
            <p
              style={{
                fontSize: "14px",
                color: "var(--text-primary)",
                marginBottom: "20px",
                lineHeight: "1.5",
              }}
            >
              Please enter a title for your journal entry before saving.
            </p>
            <div
              style={{
                display: "flex",
                gap: "12px",
                justifyContent: "flex-end",
              }}
            >
              <button
                onClick={() => {
                  setShowTitleRequiredModal(false);
                  setTimeout(() => {
                    titleInputRef.current?.focus();
                  }, 100);
                }}
                style={{
                  background: "var(--accent)",
                  border: "none",
                  borderRadius: "6px",
                  padding: "10px 20px",
                  color: "white",
                  cursor: "pointer",
                  fontSize: "14px",
                  fontWeight: "500",
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Link trade pairs modal */}
      {showLinkPairsModal && selectedEntry?.id && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => !savingLinkPairs && setShowLinkPairsModal(false)}
        >
          <div
            style={{
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "12px",
              padding: "24px",
              width: "90%",
              maxWidth: "560px",
              maxHeight: "80vh",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: "18px", fontWeight: "600", marginBottom: "8px", color: "var(--text-primary)" }}>
              Link trade pairs to this journal entry
            </h3>
            <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "16px" }}>
              Select the pairs from your Trades tab to link. Linked pairs appear above the text area and are clickable to view the chart.
            </p>
            <div style={{ position: "relative", marginBottom: "12px", flexShrink: 0 }}>
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
                placeholder="Search by symbol or date..."
                value={linkPairsSearchQuery}
                onChange={(e) => setLinkPairsSearchQuery(e.target.value)}
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
            <div style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "12px", flexShrink: 0 }}>
              <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Sort by:</span>
              <select
                value={linkPairsSortBy}
                onChange={(e) => setLinkPairsSortBy(e.target.value as "date" | "symbol" | "pnl")}
                style={{
                  padding: "8px 12px",
                  backgroundColor: "var(--bg-tertiary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px",
                  color: "var(--text-primary)",
                  fontSize: "13px",
                  outline: "none",
                }}
              >
                <option value="date">Date (exit)</option>
                <option value="symbol">Symbol</option>
                <option value="pnl">P&L</option>
              </select>
              <button
                type="button"
                onClick={() => setLinkPairsSortDirection((d) => (d === "asc" ? "desc" : "asc"))}
                title={linkPairsSortDirection === "desc" ? "Newest first (click for oldest first)" : "Oldest first (click for newest first)"}
                style={{
                  padding: "8px 12px",
                  backgroundColor: "var(--bg-tertiary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px",
                  color: "var(--text-primary)",
                  fontSize: "13px",
                  cursor: "pointer",
                }}
              >
                {linkPairsSortBy === "date" && (linkPairsSortDirection === "desc" ? "Newest first" : "Oldest first")}
                {linkPairsSortBy === "symbol" && (linkPairsSortDirection === "desc" ? "Z → A" : "A → Z")}
                {linkPairsSortBy === "pnl" && (linkPairsSortDirection === "desc" ? "High → Low" : "Low → High")}
              </button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", marginBottom: "16px", border: "1px solid var(--border-color)", borderRadius: "8px", backgroundColor: "var(--bg-primary)" }}>
              {allPairsForPicker.length === 0 ? (
                <div style={{ padding: "24px", textAlign: "center", color: "var(--text-secondary)" }}>No trade pairs found. Add trades on the Trades tab first.</div>
              ) : (() => {
                const searchLower = linkPairsSearchQuery.toLowerCase().trim();
                let filtered = searchLower
                  ? allPairsForPicker.filter((pair) => {
                      const entryStr = format(new Date(pair.entry_timestamp), "MMM d, yyyy HH:mm");
                      const exitStr = format(new Date(pair.exit_timestamp), "MMM d, yyyy HH:mm");
                      const pnlStr = pair.net_profit_loss.toFixed(2);
                      return (
                        pair.symbol.toLowerCase().includes(searchLower) ||
                        entryStr.toLowerCase().includes(searchLower) ||
                        exitStr.toLowerCase().includes(searchLower) ||
                        pnlStr.includes(linkPairsSearchQuery.trim())
                      );
                    })
                  : [...allPairsForPicker];
                if (filtered.length === 0) {
                  return <div style={{ padding: "24px", textAlign: "center", color: "var(--text-secondary)" }}>No pairs match your search.</div>;
                }
                const sorted = [...filtered].sort((a, b) => {
                  let comparison = 0;
                  if (linkPairsSortBy === "date") {
                    comparison = new Date(a.exit_timestamp).getTime() - new Date(b.exit_timestamp).getTime();
                  } else if (linkPairsSortBy === "symbol") {
                    comparison = a.symbol.localeCompare(b.symbol);
                  } else {
                    comparison = a.net_profit_loss - b.net_profit_loss;
                  }
                  return linkPairsSortDirection === "asc" ? comparison : -comparison;
                });
                return (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border-color)", backgroundColor: "var(--bg-tertiary)" }}>
                      <th style={{ padding: "10px 12px", textAlign: "left", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", width: "40px" }} />
                      <th style={{ padding: "10px 12px", textAlign: "left", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)" }}>Symbol</th>
                      <th style={{ padding: "10px 12px", textAlign: "left", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)" }}>Entry</th>
                      <th style={{ padding: "10px 12px", textAlign: "left", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)" }}>Exit</th>
                      <th style={{ padding: "10px 12px", textAlign: "right", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)" }}>P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((pair) => {
                      const key = `${pair.entry_trade_id}_${pair.exit_trade_id}`;
                      const isSelected = linkPickerSelected.has(key);
                      return (
                        <tr
                          key={key}
                          style={{
                            borderBottom: "1px solid var(--border-color)",
                            cursor: "pointer",
                            backgroundColor: isSelected ? "var(--bg-tertiary)" : "transparent",
                          }}
                          onClick={() => {
                            setLinkPickerSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(key)) next.delete(key);
                              else next.add(key);
                              return next;
                            });
                          }}
                        >
                          <td style={{ padding: "10px 12px" }}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {}}
                              onClick={(e) => e.stopPropagation()}
                              style={{ cursor: "pointer" }}
                            />
                          </td>
                          <td style={{ padding: "10px 12px", fontSize: "14px" }}>{pair.symbol}</td>
                          <td style={{ padding: "10px 12px", fontSize: "13px", color: "var(--text-secondary)" }}>{format(new Date(pair.entry_timestamp), "MMM d, yyyy HH:mm")}</td>
                          <td style={{ padding: "10px 12px", fontSize: "13px", color: "var(--text-secondary)" }}>{format(new Date(pair.exit_timestamp), "MMM d, yyyy HH:mm")}</td>
                          <td style={{ padding: "10px 12px", fontSize: "14px", textAlign: "right", fontWeight: "600", color: pair.net_profit_loss >= 0 ? "var(--profit)" : "var(--loss)" }}>
                            {pair.net_profit_loss >= 0 ? "+" : ""}{pair.net_profit_loss.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                );
              })()}
            </div>
            <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => !savingLinkPairs && setShowLinkPairsModal(false)}
                style={{ padding: "10px 20px", backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: "6px", color: "var(--text-primary)", cursor: savingLinkPairs ? "not-allowed" : "pointer", fontSize: "14px" }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingLinkPairs}
                onClick={async () => {
                  if (!selectedEntry?.id) return;
                  setSavingLinkPairs(true);
                  try {
                    const pairs = Array.from(linkPickerSelected).map((key) => {
                      const [e, x] = key.split("_").map(Number);
                      return { entry_trade_id: e, exit_trade_id: x };
                    });
                    await invoke("set_journal_entry_pairs", { journalEntryId: selectedEntry.id, pairs });
                    const updated = await invoke<PairedTrade[]>("get_journal_entry_pairs", { journalEntryId: selectedEntry.id });
                    setLinkedPairs(updated);
                    setShowLinkPairsModal(false);
                  } catch (e) {
                    console.error("Failed to save linked pairs:", e);
                    alert("Failed to save linked pairs.");
                  } finally {
                    setSavingLinkPairs(false);
                  }
                }}
                style={{ padding: "10px 20px", backgroundColor: "var(--accent)", border: "none", borderRadius: "6px", color: "white", cursor: savingLinkPairs ? "not-allowed" : "pointer", fontSize: "14px", fontWeight: "500" }}
              >
                {savingLinkPairs ? "Saving..." : "Save"}
              </button>
            </div>
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
          onClose={() => setSelectedPairForChart(null)}
        />
      )}
    </div>
  );
}
