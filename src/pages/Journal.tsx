import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { Plus, Edit2, Trash2, FileText, X, RotateCcw, Maximize2, Minimize2 } from "lucide-react";
import { format, parse } from "date-fns";
import RichTextEditor from "../components/RichTextEditor";

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
  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null);
  const [selectedTrades, setSelectedTrades] = useState<JournalTrade[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [activeTradeIndex, setActiveTradeIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<TabType>("trade");
  const [loading, setLoading] = useState(true);
  const [isMaximized, setIsMaximized] = useState(false);
  
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
  const [originalEntryData, setOriginalEntryData] = useState<{
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

  useEffect(() => {
    loadEntries();
    loadStrategies();
    loadAvailableSymbols();
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
    }
  }, [selectedEntry, isCreating, isEditing]);

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
        const type = item.checklist_type || "entry";
        if (!grouped.has(type)) {
          grouped.set(type, []);
        }
        grouped.get(type)!.push(item);
      }

      // Sort each group by item_order
      for (const [type, items] of grouped.entries()) {
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
    setIsCreating(true);
    setIsEditing(false);
    setSelectedEntry(null);
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
      const tradesData = selectedTrades.map(trade => ({
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
        trade_order: trade.trade_order,
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

  const handleDelete = async () => {
    if (selectedEntry && window.confirm(`Are you sure you want to delete "${selectedEntry.title}"?`)) {
      try {
        await invoke("delete_journal_entry", { id: selectedEntry.id });
        await loadEntries();
        setSelectedEntry(null);
        setSelectedTrades([]);
      } catch (error) {
        console.error("Error deleting entry:", error);
        alert("Failed to delete entry: " + error);
      }
    }
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
          for (const [type, items] of checklists.entries()) {
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
    if (selectedEntry) {
      // Reload the entry to reset form
      loadEntry(selectedEntry.id);
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
      await loadTrades(id);
      if (entry.strategy_id) {
        await loadStrategyChecklists(entry.strategy_id);
        await loadChecklistResponses(id);
      }
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

  const calculateProgress = (tradeIndex: number): number => {
    if (!entryFormData.strategy_id) return 0;
    const checklists = strategyChecklists.get(entryFormData.strategy_id);
    if (!checklists) return 0;

    let total = 0;
    let checked = 0;
    const tradeResponses = checklistResponses.get(tradeIndex) || new Map();

    for (const items of checklists.values()) {
      for (const item of items) {
        total++;
        if (tradeResponses.get(item.id)) {
          checked++;
        }
      }
    }

    return total > 0 ? Math.round((checked / total) * 100) : 0;
  };

  const currentTrade = tradesFormData[activeTradeIndex];
  const selectedStrategy = strategies.find(s => s.id === entryFormData.strategy_id);
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
                  onClick={handleDelete}
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
                          <div style={{ marginBottom: "8px" }}>
                            <label style={{ fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: "4px", display: "block" }}>
                              Trade
                            </label>
                            <div style={{ color: "var(--text-primary)", fontSize: "14px", whiteSpace: "pre-wrap" }}>
                              {trade.trade}
                            </div>
                          </div>
                        )}
                        {trade.what_went_well && (
                          <div style={{ marginBottom: "8px" }}>
                            <label style={{ fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: "4px", display: "block" }}>
                              What Went Well
                            </label>
                            <div style={{ color: "var(--text-primary)", fontSize: "14px", whiteSpace: "pre-wrap" }}>
                              {trade.what_went_well}
                            </div>
                          </div>
                        )}
                        {trade.what_could_be_improved && (
                          <div style={{ marginBottom: "8px" }}>
                            <label style={{ fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: "4px", display: "block" }}>
                              What Could Be Improved
                            </label>
                            <div style={{ color: "var(--text-primary)", fontSize: "14px", whiteSpace: "pre-wrap" }}>
                              {trade.what_could_be_improved}
                            </div>
                          </div>
                        )}
                        {trade.emotional_state && (
                          <div style={{ marginBottom: "8px" }}>
                            <label style={{ fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: "4px", display: "block" }}>
                              Emotional State
                            </label>
                            <div style={{ color: "var(--text-primary)", fontSize: "14px", whiteSpace: "pre-wrap" }}>
                              {trade.emotional_state}
                            </div>
                          </div>
                        )}
                        {trade.notes && (
                          <div style={{ marginBottom: "8px" }}>
                            <label style={{ fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: "4px", display: "block" }}>
                              Notes
                            </label>
                            <div style={{ color: "var(--text-primary)", fontSize: "14px", whiteSpace: "pre-wrap" }}>
                              {trade.notes}
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

              {/* Trade Tabs */}
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

              {/* Content Tabs for Current Trade */}
              {currentTrade && (
                <>
                  {/* Trade-specific fields - Symbol, Position, Entry Type, Exit Type, and Outcome */}
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
                          onClick={() => setActiveTab(tab.id)}
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

                  {/* Tab Content */}
                  <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", padding: "20px" }}>
                    {activeTab === "trade" && (
                      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
                        <RichTextEditor
                          value={currentTrade.trade}
                          onChange={(content: string) => updateTradeFormData(activeTradeIndex, "trade", content)}
                          placeholder="Describe the related trades..."
                          readOnly={false}
                        />
                      </div>
                    )}
                    {activeTab === "what_went_well" && (
                      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
                        <RichTextEditor
                          value={currentTrade.what_went_well}
                          onChange={(content: string) => updateTradeFormData(activeTradeIndex, "what_went_well", content)}
                          placeholder="What went well..."
                          readOnly={false}
                        />
                      </div>
                    )}
                    {activeTab === "what_could_be_improved" && (
                      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
                        <RichTextEditor
                          value={currentTrade.what_could_be_improved}
                          onChange={(content: string) => updateTradeFormData(activeTradeIndex, "what_could_be_improved", content)}
                          placeholder="What could be improved..."
                          readOnly={false}
                        />
                      </div>
                    )}
                    {activeTab === "emotional_state" && (
                      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
                        <RichTextEditor
                          value={currentTrade.emotional_state}
                          onChange={(content: string) => updateTradeFormData(activeTradeIndex, "emotional_state", content)}
                          placeholder="Emotional state..."
                          readOnly={false}
                        />
                      </div>
                    )}
                    {activeTab === "notes" && (
                      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
                        <RichTextEditor
                          value={currentTrade.notes}
                          onChange={(content: string) => updateTradeFormData(activeTradeIndex, "notes", content)}
                          placeholder="Notes..."
                          readOnly={false}
                        />
                      </div>
                    )}
                    {activeTab === "checklists" && (
                      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
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
                      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
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
        <div style={{ flex: 1, overflowY: "auto", padding: "12px" }}>
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
          {/* Progress Bar */}
          {(isCreating || isEditing) && entryFormData.strategy_id && currentTrade && (
            <div style={{ marginBottom: "12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>Checklist Progress</span>
                <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>{calculateProgress(activeTradeIndex)}%</span>
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
                    width: `${calculateProgress(activeTradeIndex)}%`,
                    height: "100%",
                    backgroundColor: "var(--accent)",
                    transition: "width 0.3s",
                  }}
                />
              </div>
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
