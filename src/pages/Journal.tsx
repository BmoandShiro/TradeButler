import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { Plus, Edit2, Trash2, FileText, X, RotateCcw, Maximize2, Minimize2 } from "lucide-react";
import { format, parse } from "date-fns";
import RichTextEditor from "../components/RichTextEditor";
import { saveAllScrollPositions, restoreAllScrollPositions } from "../utils/scrollManager";

interface JournalEntry {
  id: number;
  date: string;
  title: string;
  strategy_id: number | null;
  created_at: string | null;
  updated_at: string | null;
}

interface JournalTrade {
  id: number;
  journal_entry_id: number;
  symbol: string | null;
  position: string | null;
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
}

type TabType = "trade" | "what_went_well" | "what_could_be_improved" | "emotional_state" | "notes" | "checklists" | "survey";

export default function Journal() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
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
  
  // Entry-level form state
  const [entryFormData, setEntryFormData] = useState({
    date: format(new Date(), "yyyy-MM-dd"),
    title: "",
    strategy_id: null as number | null,
  });

  // Trade-level form state (array of trades)
  const [tradesFormData, setTradesFormData] = useState<Array<{
    id: number | null;
    symbol: string;
    position: string;
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
  
  // Available symbols for dropdown
  const [availableSymbols, setAvailableSymbols] = useState<string[]>([]);
  
  // Modal state
  const [showTitleRequiredModal, setShowTitleRequiredModal] = useState(false);
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  
  // Edit history for undo functionality
  const [editHistory, setEditHistory] = useState<Array<{
    entry: { date: string; title: string; strategy_id: number | null };
    trades: Array<{
      id: number | null;
      symbol: string;
      position: string;
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
        
        setActiveTradeIndex(workInProgress.activeTradeIndex);
        setActiveTab(workInProgress.activeTab);
        setIsCreating(workInProgress.isCreating);
        setIsEditing(workInProgress.isEditing);
        
        // Restore scroll positions
        workInProgress.scrollPositions.forEach(([tab, pos]: [TabType, number]) => {
          tabScrollPositions.current.set(tab, pos);
        });
        
        // If editing an existing entry, load it
        if (workInProgress.selectedEntryId && !workInProgress.isCreating) {
          loadEntry(workInProgress.selectedEntryId);
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
  }, [entryFormData, tradesFormData, checklistResponses, activeTradeIndex, activeTab, isCreating, isEditing, selectedEntry]);

  useEffect(() => {
    loadEntries();
    loadStrategies();
    loadAvailableSymbols();
    
    // Restore selected entry if we have a saved ID
    const savedEntryId = localStorage.getItem('journal_selected_entry_id');
    if (savedEntryId) {
      const entryId = parseInt(savedEntryId, 10);
      if (!isNaN(entryId)) {
        // Wait for entries to load, then restore
        setTimeout(() => {
          loadEntry(entryId);
        }, 300);
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
      if (selectedEntry.strategy_id) {
        loadChecklistResponses(selectedEntry.id);
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

  const loadTrades = async (entryId: number) => {
    try {
      const trades = await invoke<JournalTrade[]>("get_journal_trades", { journalEntryId: entryId });
      setSelectedTrades(trades);
    } catch (error) {
      console.error("Error loading trades:", error);
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
      // Reset checklist responses for all trades
      const newResponses = new Map<number, Map<number, boolean>>();
      tradesFormData.forEach((_, index) => {
        newResponses.set(index, new Map());
      });
      setChecklistResponses(newResponses);
    } catch (error) {
      console.error("Error loading strategy checklists:", error);
    }
  };

  const loadChecklistResponses = async (entryId: number) => {
    try {
      const responses = await invoke<JournalChecklistResponse[]>("get_journal_checklist_responses", {
        journalEntryId: entryId,
      });

      // For now, we'll load responses at entry level (they're stored per entry, not per trade)
      // In the future, we might want to store responses per trade
      const responseMap = new Map<number, boolean>();
      for (const response of responses) {
        responseMap.set(response.checklist_item_id, response.is_checked);
      }
      
      // Apply to all trades for now
      const newResponses = new Map<number, Map<number, boolean>>();
      selectedTrades.forEach((_, index) => {
        newResponses.set(index, new Map(responseMap));
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
    setEntryFormData({
      date: format(new Date(), "yyyy-MM-dd"),
      title: "",
      strategy_id: null,
    });
    setTradesFormData([{
      id: null,
      symbol: "",
      position: "",
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
    tabScrollPositions.current.clear();
  };

  const handleEdit = async () => {
    if (selectedEntry) {
      setIsEditing(true);
      setIsCreating(false);
      setEntryFormData({
        date: selectedEntry.date,
        title: selectedEntry.title,
        strategy_id: selectedEntry.strategy_id,
      });
      await loadTrades(selectedEntry.id);
      if (selectedEntry.strategy_id) {
        await loadStrategyChecklists(selectedEntry.strategy_id);
        await loadChecklistResponses(selectedEntry.id);
      }
      
      // Convert trades to form data
      const tradesData: Array<{
        id: number | null;
        symbol: string;
        position: string;
        entry_type: string;
        exit_type: string;
        trade: string;
        what_went_well: string;
        what_could_be_improved: string;
        emotional_state: string;
        notes: string;
        outcome: string;
        trade_order: number;
      }> = selectedTrades.map(trade => ({
        id: trade.id,
        symbol: trade.symbol || "",
        position: trade.position || "",
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

  const handleAddTrade = () => {
    const newTrade = {
      id: null,
      symbol: "",
      position: "",
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

      if (isCreating) {
        entryId = await invoke<number>("create_journal_entry", {
          date: entryFormData.date,
          title: entryFormData.title,
          strategyId: entryFormData.strategy_id,
        });
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
        });
      } else {
        return;
      }

      // Save all trades
      for (let i = 0; i < tradesFormData.length; i++) {
        const tradeData = tradesFormData[i];
        if (tradeData.id) {
          await invoke("update_journal_trade", {
            id: tradeData.id,
            symbol: tradeData.symbol || null,
            position: tradeData.position || null,
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
          await invoke("create_journal_trade", {
            journalEntryId: entryId,
            symbol: tradeData.symbol || null,
            position: tradeData.position || null,
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
        }
      }

      // Save checklist responses
      if (entryFormData.strategy_id) {
        const checklists = strategyChecklists.get(entryFormData.strategy_id);
        if (checklists) {
          const responses: [number, boolean][] = [];
          const firstTradeResponses = checklistResponses.get(0) || new Map();
          for (const [, items] of checklists.entries()) {
            for (const item of items) {
              const isChecked = firstTradeResponses.get(item.id) || false;
              responses.push([item.id, isChecked]);
            }
          }
          await invoke("save_journal_checklist_responses", {
            journalEntryId: entryId,
            responses: responses,
          });
        }
      }

      // Reload trades to get updated IDs
      await loadTrades(entryId);
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

    try {
      let entryId: number;

      if (isCreating) {
        entryId = await invoke<number>("create_journal_entry", {
          date: entryFormData.date,
          title: entryFormData.title,
          strategyId: entryFormData.strategy_id,
        });
      } else if (selectedEntry) {
        entryId = selectedEntry.id;
        await invoke("update_journal_entry", {
          id: selectedEntry.id,
          date: entryFormData.date,
          title: entryFormData.title,
          strategyId: entryFormData.strategy_id,
        });
        
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

      // Save all trades
      for (let i = 0; i < tradesFormData.length; i++) {
        const tradeData = tradesFormData[i];
        if (tradeData.id) {
          await invoke("update_journal_trade", {
            id: tradeData.id,
            symbol: tradeData.symbol || null,
            position: tradeData.position || null,
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
          await invoke("create_journal_trade", {
            journalEntryId: entryId,
            symbol: tradeData.symbol || null,
            position: tradeData.position || null,
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
        }
      }

      // Save checklist responses (at entry level for now)
      if (entryFormData.strategy_id) {
        const checklists = strategyChecklists.get(entryFormData.strategy_id);
        if (checklists) {
          const responses: [number, boolean][] = [];
          // Use responses from the first trade (or combine all trades' responses)
          const firstTradeResponses = checklistResponses.get(0) || new Map();
          for (const [, items] of checklists.entries()) {
            for (const item of items) {
              const isChecked = firstTradeResponses.get(item.id) || false;
              responses.push([item.id, isChecked]);
            }
          }
          await invoke("save_journal_checklist_responses", {
            journalEntryId: entryId,
            responses: responses,
          });
        }
      }

      await loadEntries();
      
      // Reload the saved entry
      const savedEntry = await invoke<JournalEntry>("get_journal_entry", { id: entryId });
      setSelectedEntry(savedEntry);
      await loadTrades(entryId);
      setIsCreating(false);
      setIsEditing(false);
      setEditHistory([]);
      setOriginalEntryData(null);
      
      // Clear work in progress after successful save
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
      });
      setTradesFormData([{
        id: null,
        symbol: "",
        position: "",
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

  const loadEntry = async (id: number) => {
    try {
      const entry = await invoke<JournalEntry>("get_journal_entry", { id });
      setSelectedEntry(entry);
      // Save selected entry ID to localStorage
      localStorage.setItem('journal_selected_entry_id', id.toString());
      await loadTrades(id);
      if (entry.strategy_id) {
        await loadStrategyChecklists(entry.strategy_id);
        await loadChecklistResponses(id);
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

  const getChecklistTitle = (type: string): string => {
    const titleMap: Record<string, string> = {
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

  const currentTrade = tradesFormData[activeTradeIndex];
  const currentChecklists = entryFormData.strategy_id ? strategyChecklists.get(entryFormData.strategy_id) : null;
  const defaultTypes = ["entry", "take_profit"];
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
                    {selectedTrades.map((trade, index) => (
                      <div key={trade.id || index} style={{ marginBottom: "24px", padding: "16px", backgroundColor: "var(--bg-secondary)", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
                        <h4 style={{ fontSize: "14px", fontWeight: "600", marginBottom: "12px", color: "var(--text-primary)" }}>
                          Trade {index + 1} {trade.symbol && `- ${trade.symbol}`}
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
                    ))}
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
                <div style={{ padding: "20px", borderBottom: "1px solid var(--border-color)" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    <div>
                      <label style={{ display: "block", marginBottom: "6px", fontSize: "12px", fontWeight: "500" }}>
                        Date
                      </label>
                      <input
                        type="date"
                        value={entryFormData.date}
                        onChange={(e) => setEntryFormData({ ...entryFormData, date: e.target.value })}
                        style={{
                          width: "100%",
                          padding: "8px",
                          backgroundColor: "var(--bg-secondary)",
                          border: "1px solid var(--border-color)",
                          borderRadius: "4px",
                          color: "var(--text-primary)",
                          fontSize: "14px",
                        }}
                      />
                    </div>
                    <div>
                      <label style={{ display: "block", marginBottom: "6px", fontSize: "12px", fontWeight: "500" }}>
                        Title
                      </label>
                      <input
                        ref={titleInputRef}
                        type="text"
                        value={entryFormData.title}
                        onChange={(e) => {
                          const newData = { ...entryFormData, title: e.target.value };
                          setEntryFormData(newData);
                          // Track history for undo
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
                          padding: "8px",
                          backgroundColor: "var(--bg-secondary)",
                          border: "1px solid var(--border-color)",
                          borderRadius: "4px",
                          color: "var(--text-primary)",
                          fontSize: "14px",
                        }}
                      />
                    </div>
                    <div>
                      <label style={{ display: "block", marginBottom: "6px", fontSize: "12px", fontWeight: "500" }}>
                        Strategy
                      </label>
                      <select
                        value={entryFormData.strategy_id || ""}
                        onChange={(e) => setEntryFormData({ ...entryFormData, strategy_id: e.target.value ? parseInt(e.target.value) : null })}
                        style={{
                          width: "100%",
                          padding: "8px",
                          backgroundColor: "var(--bg-secondary)",
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
                          title="Remove trade"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  );
                })}
                <button
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
                      { id: "trade" as TabType, label: "Trade" },
                      { id: "what_went_well" as TabType, label: "What Went Well" },
                      { id: "what_could_be_improved" as TabType, label: "What Could Be Improved" },
                      { id: "emotional_state" as TabType, label: "Emotional State" },
                      { id: "notes" as TabType, label: "Notes" },
                      { id: "checklists" as TabType, label: "Checklists" },
                      { id: "survey" as TabType, label: "Survey" },
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
                              { id: "trade" as TabType, label: "Trade" },
                              { id: "what_went_well" as TabType, label: "What Went Well" },
                              { id: "what_could_be_improved" as TabType, label: "What Could Be Improved" },
                              { id: "emotional_state" as TabType, label: "Emotional State" },
                              { id: "notes" as TabType, label: "Notes" },
                              { id: "checklists" as TabType, label: "Checklists" },
                              { id: "survey" as TabType, label: "Survey" },
                            ].find(tab => tab.id === activeTab)?.label || "Tab"}
                          </h3>
                        </div>
                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                          {[
                            { id: "trade" as TabType, label: "Trade" },
                            { id: "what_went_well" as TabType, label: "What Went Well" },
                            { id: "what_could_be_improved" as TabType, label: "What Could Be Improved" },
                            { id: "emotional_state" as TabType, label: "Emotional State" },
                            { id: "notes" as TabType, label: "Notes" },
                            { id: "checklists" as TabType, label: "Checklists" },
                            { id: "survey" as TabType, label: "Survey" },
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
                        <RichTextEditor
                          value={currentTrade.emotional_state}
                          onChange={(content: string) => updateTradeFormData(activeTradeIndex, "emotional_state", content)}
                          placeholder="Emotional state..."
                          readOnly={false}
                        />
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

                              // Organize items: groups and regular items
                              const groups = items.filter(item => !item.parent_id && items.some(child => child.parent_id === item.id));
                              const regularItems = items.filter(item => !item.parent_id && !items.some(child => child.parent_id === item.id));
                              const groupedItems = items.filter(item => item.parent_id !== null && items.some(p => p.id === item.parent_id));
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
                                <div key={type} style={{ marginBottom: "24px" }}>
                                  <h4 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "12px", color: "var(--text-primary)" }}>
                                    {getChecklistTitle(type)}
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
                                        {children.map((child) => (
                                          <div
                                            key={child.id}
                                            style={{
                                              display: "flex",
                                              alignItems: "center",
                                              gap: "8px",
                                              padding: "8px 12px",
                                              marginLeft: "20px",
                                              marginBottom: "4px",
                                            }}
                                          >
                                            <input
                                              type="checkbox"
                                              checked={tradeResponses.get(child.id) || false}
                                              onChange={() => toggleChecklistItem(activeTradeIndex, child.id)}
                                              style={{
                                                cursor: "pointer",
                                                width: "16px",
                                                height: "16px",
                                              }}
                                            />
                                            <label
                                              style={{
                                                flex: 1,
                                                fontSize: "14px",
                                                color: "var(--text-primary)",
                                                cursor: "pointer",
                                              }}
                                              onClick={() => toggleChecklistItem(activeTradeIndex, child.id)}
                                            >
                                              {child.item_text}
                                            </label>
                                          </div>
                                        ))}
                                      </div>
                                    );
                                  })}
                                  {/* Render regular items */}
                                  {regularItems.map((item) => (
                                    <div
                                      key={item.id}
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "8px",
                                        padding: "8px 12px",
                                        marginBottom: "4px",
                                        backgroundColor: "var(--bg-tertiary)",
                                        borderRadius: "6px",
                                      }}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={tradeResponses.get(item.id) || false}
                                        onChange={() => toggleChecklistItem(activeTradeIndex, item.id)}
                                        style={{
                                          cursor: "pointer",
                                          width: "16px",
                                          height: "16px",
                                        }}
                                      />
                                      <label
                                        style={{
                                          flex: 1,
                                          fontSize: "14px",
                                          color: "var(--text-primary)",
                                          cursor: "pointer",
                                        }}
                                        onClick={() => toggleChecklistItem(activeTradeIndex, item.id)}
                                      >
                                        {item.item_text}
                                      </label>
                                    </div>
                                  ))}
                                </div>
                              );
                            })}
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
            padding: "20px",
            borderBottom: "1px solid var(--border-color)",
          }}
        >
          <h1 style={{ fontSize: "20px", fontWeight: "bold" }}>Entries</h1>
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
              {entries.map((entry) => {
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
    </div>
  );
}
