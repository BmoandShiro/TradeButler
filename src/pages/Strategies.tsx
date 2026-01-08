import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { Plus, Edit2, Trash2, Target, Maximize2, Minimize2, FileText, TrendingUp, ListChecks, GripVertical, X } from "lucide-react";
import { format } from "date-fns";
import RichTextEditor from "../components/RichTextEditor";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface Strategy {
  id: number;
  name: string;
  description: string | null;
  notes: string | null;
  created_at: string | null;
  color: string | null;
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

type TabType = "notes" | "trades" | "checklists";

interface ChecklistItem {
  id: number;
  strategy_id: number;
  item_text: string;
  is_checked: boolean;
  item_order: number;
  checklist_type: string;
}

function SortableChecklistItem({ item, onDelete }: { item: ChecklistItem; onDelete: () => void }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "10px",
        backgroundColor: "var(--bg-tertiary)",
        border: "1px solid var(--border-color)",
        borderRadius: "6px",
        marginBottom: "8px",
      }}
    >
      <div
        {...attributes}
        {...listeners}
        style={{
          cursor: "grab",
          color: "var(--text-secondary)",
          display: "flex",
          alignItems: "center",
        }}
      >
        <GripVertical size={16} />
      </div>
      <div style={{ flex: 1, fontSize: "14px", color: "var(--text-primary)" }}>
        {item.item_text}
      </div>
      <button
        onClick={onDelete}
        style={{
          background: "transparent",
          border: "none",
          color: "var(--danger)",
          cursor: "pointer",
          padding: "4px",
          display: "flex",
          alignItems: "center",
        }}
        title="Delete"
      >
        <X size={16} />
      </button>
    </div>
  );
}

export default function Strategies() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingFormData, setEditingFormData] = useState({
    name: "",
    description: "",
    color: "#3b82f6",
  });
  const [newStrategyNotes, setNewStrategyNotes] = useState("");
  const [selectedStrategy, setSelectedStrategy] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>("notes");
  const [isMaximized, setIsMaximized] = useState(false);
  const [strategyPairs, setStrategyPairs] = useState<Map<number, PairedTrade[]>>(new Map());
  const [loadingPairs, setLoadingPairs] = useState<Set<number>>(new Set());
  const [strategyStats, setStrategyStats] = useState<Map<number, { totalTrades: number; totalPnL: number; winRate: number }>>(new Map());
  const [notesContent, setNotesContent] = useState<Map<number, string>>(new Map());
  const [checklists, setChecklists] = useState<Map<number, { entry: ChecklistItem[]; takeProfit: ChecklistItem[] }>>(new Map());
  const [newChecklistItem, setNewChecklistItem] = useState<{ entry: string; takeProfit: string }>({ entry: "", takeProfit: "" });
  
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    loadStrategies();
  }, []);

  useEffect(() => {
    if (selectedStrategy) {
      loadStrategyData(selectedStrategy);
    }
  }, [selectedStrategy, activeTab]);

  const calculateStrategyStats = (pairs: PairedTrade[]) => {
    const totalTrades = pairs.length;
    const totalPnL = pairs.reduce((sum, pair) => sum + pair.net_profit_loss, 0);
    const winningTrades = pairs.filter(pair => pair.net_profit_loss > 0).length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    return { totalTrades, totalPnL, winRate };
  };

  const loadStrategyStats = async (strategyId: number) => {
    try {
      const pairingMethod = localStorage.getItem("tradebutler_pairing_method") || "FIFO";
      const pairs = await invoke<PairedTrade[]>("get_paired_trades_by_strategy", {
        strategyId: strategyId,
        pairingMethod: pairingMethod,
        startDate: null,
        endDate: null,
      });
      const stats = calculateStrategyStats(pairs);
      setStrategyStats(new Map(strategyStats.set(strategyId, stats)));
    } catch (error) {
      console.error("Error loading strategy stats:", error);
    }
  };

  const loadStrategies = async () => {
    try {
      const data = await invoke<Strategy[]>("get_strategies");
      setStrategies(data);
      // Initialize notes content
      const notesMap = new Map<number, string>();
      data.forEach((s) => {
        if (s.notes) {
          notesMap.set(s.id, s.notes);
        }
      });
      setNotesContent(notesMap);
      // Load stats for all strategies
      for (const strategy of data) {
        if (strategy.id) {
          await loadStrategyStats(strategy.id);
        }
      }
    } catch (error) {
      console.error("Error loading strategies:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadStrategyData = async (strategyId: number) => {
    // Always sync notes from strategies array to notesContent to ensure they're up to date
    const strategy = strategies.find((s) => s.id === strategyId);
    if (strategy) {
      // Only update if we're not currently editing (to preserve unsaved changes)
      if (!isEditing || !notesContent.has(strategyId)) {
        const notesToSet = strategy.notes || "";
        if (notesContent.get(strategyId) !== notesToSet) {
          setNotesContent(new Map(notesContent.set(strategyId, notesToSet)));
        }
      }
    }
    
    // Load trades
    if (activeTab === "trades" && !strategyPairs.has(strategyId)) {
      setLoadingPairs(new Set([...loadingPairs, strategyId]));
      try {
        const pairingMethod = localStorage.getItem("tradebutler_pairing_method") || "FIFO";
        const pairs = await invoke<PairedTrade[]>("get_paired_trades_by_strategy", {
          strategyId: strategyId,
          pairingMethod: pairingMethod,
          startDate: null,
          endDate: null,
        });
        setStrategyPairs(new Map(strategyPairs.set(strategyId, pairs)));
        // Update stats when pairs are loaded
        const stats = calculateStrategyStats(pairs);
        setStrategyStats(new Map(strategyStats.set(strategyId, stats)));
      } catch (error) {
        console.error("Error loading strategy pairs:", error);
      } finally {
        const newLoading = new Set(loadingPairs);
        newLoading.delete(strategyId);
        setLoadingPairs(newLoading);
      }
    }
    // Load checklists
    if (activeTab === "checklists" && !checklists.has(strategyId)) {
      await loadChecklists(strategyId);
    }
  };

  const loadChecklists = async (strategyId: number) => {
    try {
      const entryItems = await invoke<ChecklistItem[]>("get_strategy_checklist", {
        strategyId: strategyId,
        checklistType: "entry",
      });
      const takeProfitItems = await invoke<ChecklistItem[]>("get_strategy_checklist", {
        strategyId: strategyId,
        checklistType: "take_profit",
      });
      setChecklists(new Map(checklists.set(strategyId, {
        entry: entryItems,
        takeProfit: takeProfitItems,
      })));
    } catch (error) {
      console.error("Error loading checklists:", error);
    }
  };

  const addChecklistItem = async (strategyId: number, type: "entry" | "take_profit", text: string) => {
    if (!text.trim()) return;
    try {
      const currentChecklist = checklists.get(strategyId) || { entry: [], takeProfit: [] };
      const items = type === "entry" ? currentChecklist.entry : currentChecklist.takeProfit;
      const maxOrder = items.length > 0 ? Math.max(...items.map(i => i.item_order)) : -1;
      
      const newId = await invoke<number>("save_strategy_checklist_item", {
        id: null,
        strategyId: strategyId,
        itemText: text.trim(),
        isChecked: false,
        itemOrder: maxOrder + 1,
        checklistType: type,
      });

      const newItem: ChecklistItem = {
        id: newId,
        strategy_id: strategyId,
        item_text: text.trim(),
        is_checked: false,
        item_order: maxOrder + 1,
        checklist_type: type,
      };

      const updatedChecklist = {
        ...currentChecklist,
        [type === "entry" ? "entry" : "takeProfit"]: [...items, newItem],
      };
      setChecklists(new Map(checklists.set(strategyId, updatedChecklist)));
      setNewChecklistItem({ ...newChecklistItem, [type === "entry" ? "entry" : "takeProfit"]: "" });
    } catch (error) {
      console.error("Error adding checklist item:", error);
      alert("Failed to add checklist item: " + error);
    }
  };

  const deleteChecklistItem = async (strategyId: number, itemId: number, type: "entry" | "take_profit") => {
    try {
      await invoke("delete_strategy_checklist_item", { id: itemId });
      const currentChecklist = checklists.get(strategyId) || { entry: [], takeProfit: [] };
      const items = type === "entry" ? currentChecklist.entry : currentChecklist.takeProfit;
      const updatedItems = items.filter(item => item.id !== itemId);
      const updatedChecklist = {
        ...currentChecklist,
        [type === "entry" ? "entry" : "takeProfit"]: updatedItems,
      };
      setChecklists(new Map(checklists.set(strategyId, updatedChecklist)));
    } catch (error) {
      console.error("Error deleting checklist item:", error);
      alert("Failed to delete checklist item: " + error);
    }
  };

  const reorderChecklistItems = async (strategyId: number, type: "entry" | "take_profit", activeId: number, overId: number) => {
    const currentChecklist = checklists.get(strategyId) || { entry: [], takeProfit: [] };
    const items = type === "entry" ? currentChecklist.entry : currentChecklist.takeProfit;
    
    const oldIndex = items.findIndex(item => item.id === activeId);
    const newIndex = items.findIndex(item => item.id === overId);
    
    if (oldIndex === -1 || newIndex === -1) return;
    
    const reorderedItems = arrayMove(items, oldIndex, newIndex);
    const updatedItems = reorderedItems.map((item, index) => ({
      ...item,
      item_order: index,
    }));

    // Update all items with new order
    try {
      for (const item of updatedItems) {
        await invoke("save_strategy_checklist_item", {
          id: item.id,
          strategyId: strategyId,
          itemText: item.item_text,
          isChecked: item.is_checked,
          itemOrder: item.item_order,
          checklistType: type,
        });
      }
    } catch (error) {
      console.error("Error reordering checklist items:", error);
      alert("Failed to reorder checklist items: " + error);
      return;
    }

    const updatedChecklist = {
      ...currentChecklist,
      [type === "entry" ? "entry" : "takeProfit"]: updatedItems,
    };
    setChecklists(new Map(checklists.set(strategyId, updatedChecklist)));
  };

  const handleCreateNew = () => {
    setIsCreating(true);
    setIsEditing(false);
    setSelectedStrategy(null);
    setEditingFormData({ name: "", description: "", color: "#3b82f6" });
    setNewStrategyNotes("");
    setActiveTab("notes");
  };

  const handleSaveNew = async () => {
    if (!editingFormData.name.trim()) {
      alert("Strategy name is required");
      return;
    }
    try {
      // Create the strategy - returns just the ID
      const newStrategyId = await invoke<number>("create_strategy", {
        name: editingFormData.name,
        description: editingFormData.description || null,
        notes: newStrategyNotes || null,
        color: editingFormData.color || null,
      });

      // Reset and reload
      setIsCreating(false);
      setNewStrategyNotes("");
      setEditingFormData({ name: "", description: "", color: "#3b82f6" });
      await loadStrategies();
      setSelectedStrategy(newStrategyId);
    } catch (error) {
      console.error("Error creating strategy:", error);
      alert("Failed to create strategy: " + error);
    }
  };

  const handleCancelNew = () => {
    setIsCreating(false);
    setEditingFormData({ name: "", description: "", color: "#3b82f6" });
    setNewStrategyNotes("");
    setSelectedStrategy(null);
  };

  const handleEditClick = () => {
    if (selectedStrategyData) {
      setIsEditing(true);
      setEditingFormData({
        name: selectedStrategyData.name,
        description: selectedStrategyData.description || "",
        color: selectedStrategyData.color || "#3b82f6",
      });
      // Ensure notes are loaded into notesContent for editing
      if (selectedStrategyData.notes && !notesContent.has(selectedStrategyData.id)) {
        setNotesContent(new Map(notesContent.set(selectedStrategyData.id, selectedStrategyData.notes)));
      } else if (!selectedStrategyData.notes) {
        // Initialize empty notes if none exist
        setNotesContent(new Map(notesContent.set(selectedStrategyData.id, "")));
      }
    }
  };

  const handleSaveEdit = async () => {
    if (!selectedStrategyData) return;
    try {
      const currentNotes = notesContent.get(selectedStrategyData.id) || selectedStrategyData.notes || "";
      await invoke("update_strategy", {
        id: selectedStrategyData.id,
        name: editingFormData.name,
        description: editingFormData.description || null,
        notes: currentNotes || null,
        color: editingFormData.color || null,
      });
      setIsEditing(false);
      loadStrategies();
    } catch (error) {
      console.error("Error saving strategy:", error);
      alert("Failed to save strategy: " + error);
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    if (selectedStrategyData) {
      setEditingFormData({
        name: selectedStrategyData.name,
        description: selectedStrategyData.description || "",
        color: selectedStrategyData.color || "#3b82f6",
      });
      // Reset notes to original value from database
      if (selectedStrategyData.notes) {
        setNotesContent(new Map(notesContent.set(selectedStrategyData.id, selectedStrategyData.notes)));
      } else {
        setNotesContent(new Map(notesContent.set(selectedStrategyData.id, "")));
      }
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Are you sure you want to delete this strategy? Trades using this strategy will be unassigned.")) {
      return;
    }
    try {
      await invoke("delete_strategy", { id });
      if (selectedStrategy === id) {
        setSelectedStrategy(null);
      }
      loadStrategies();
    } catch (error) {
      console.error("Error deleting strategy:", error);
      alert("Failed to delete strategy: " + error);
    }
  };


  const handleNotesChange = async (strategyId: number | null, content: string) => {
    if (isCreating) {
      setNewStrategyNotes(content);
      return;
    }
    if (!isEditing || !strategyId) return;
    setNotesContent(new Map(notesContent.set(strategyId, content)));
    // Auto-save after a delay
    const timeoutId = setTimeout(async () => {
      try {
        const strategy = strategies.find((s) => s.id === strategyId);
        if (strategy) {
          await invoke("update_strategy", {
            id: strategyId,
            name: strategy.name,
            description: strategy.description || null,
            notes: content || null,
            color: strategy.color || null,
          });
        }
      } catch (error) {
        console.error("Error saving notes:", error);
      }
    }, 1000);
    return () => clearTimeout(timeoutId);
  };

  if (loading) {
    return (
      <div style={{ padding: "40px", textAlign: "center" }}>
        <p>Loading strategies...</p>
      </div>
    );
  }

  const selectedStrategyData = strategies.find((s) => s.id === selectedStrategy);
  const pairs = selectedStrategy ? strategyPairs.get(selectedStrategy) || [] : [];
  const isLoadingPairs = selectedStrategy ? loadingPairs.has(selectedStrategy) : false;

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden", flex: 1 }}>
      {/* Left Panel - Strategy List */}
      <div
        style={{
          width: isMaximized ? "0" : "300px",
          borderRight: isMaximized ? "none" : "1px solid var(--border-color)",
          display: isMaximized ? "none" : "flex",
          flexDirection: "column",
          backgroundColor: "var(--bg-secondary)",
          overflow: "hidden",
          transition: "width 0.2s, border 0.2s",
        }}
      >
        <div
          style={{
            padding: "20px",
            borderBottom: "1px solid var(--border-color)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <h1 style={{ fontSize: "24px", fontWeight: "bold" }}>Strategies</h1>
          <button
            onClick={handleCreateNew}
            style={{
              background: "var(--accent)",
              border: "none",
              borderRadius: "6px",
              padding: "8px 12px",
              color: "white",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "13px",
              fontWeight: "500",
            }}
          >
            <Plus size={16} />
            New
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "12px" }}>

          {strategies.length === 0 ? (
            <div
              style={{
                backgroundColor: "var(--bg-tertiary)",
                border: "1px solid var(--border-color)",
                borderRadius: "6px",
                padding: "30px",
                textAlign: "center",
              }}
            >
              <Target size={32} style={{ margin: "0 auto 12px", opacity: 0.5 }} />
              <p style={{ color: "var(--text-secondary)", fontSize: "13px" }}>
                No strategies yet. Create your first strategy.
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {strategies.map((strategy) => {
                const isSelected = selectedStrategy === strategy.id;
                return (
                  <div
                    key={strategy.id}
                    onClick={() => {
                      setSelectedStrategy(strategy.id);
                      setActiveTab("notes");
                      // Only reset editing/creating when switching to a different strategy
                      if (selectedStrategy !== strategy.id) {
                        setIsEditing(false);
                        setIsCreating(false);
                      }
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
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                      <div
                        style={{
                          width: "10px",
                          height: "10px",
                          borderRadius: "50%",
                          backgroundColor: strategy.color || "var(--accent)",
                        }}
                      />
                      <h3
                        style={{
                          fontSize: "14px",
                          fontWeight: "600",
                          color: isSelected ? "white" : "var(--text-primary)",
                        }}
                      >
                        {strategy.name}
                      </h3>
                    </div>
                    {strategy.description && (
                      <p
                        style={{
                          color: isSelected ? "rgba(255,255,255,0.8)" : "var(--text-secondary)",
                          fontSize: "12px",
                          marginTop: "4px",
                        }}
                      >
                        {strategy.description}
                      </p>
                    )}
                    {strategy.id && strategyStats.has(strategy.id) && (() => {
                      const stats = strategyStats.get(strategy.id)!;
                      return (
                        <div style={{ 
                          display: "flex", 
                          gap: "16px", 
                          marginTop: "8px",
                          paddingTop: "8px",
                          borderTop: `1px solid ${isSelected ? "rgba(255,255,255,0.2)" : "var(--border-color)"}`
                        }}>
                          <div>
                            <div style={{ 
                              fontSize: "10px", 
                              color: isSelected ? "rgba(255,255,255,0.6)" : "var(--text-secondary)",
                              marginBottom: "2px"
                            }}>
                              TOTAL TRADES
                            </div>
                            <div style={{ 
                              fontSize: "14px", 
                              fontWeight: "600",
                              color: isSelected ? "white" : "var(--text-primary)"
                            }}>
                              {stats.totalTrades}
                            </div>
                          </div>
                          <div>
                            <div style={{ 
                              fontSize: "10px", 
                              color: isSelected ? "rgba(255,255,255,0.6)" : "var(--text-secondary)",
                              marginBottom: "2px"
                            }}>
                              TOTAL P&L
                            </div>
                            <div style={{ 
                              fontSize: "14px", 
                              fontWeight: "600",
                              color: stats.totalPnL >= 0 ? "var(--profit)" : "var(--loss)"
                            }}>
                              ${stats.totalPnL >= 0 ? "+" : ""}{stats.totalPnL.toFixed(2)}
                            </div>
                          </div>
                          <div>
                            <div style={{ 
                              fontSize: "10px", 
                              color: isSelected ? "rgba(255,255,255,0.6)" : "var(--text-secondary)",
                              marginBottom: "2px"
                            }}>
                              WIN %
                            </div>
                            <div style={{ 
                              fontSize: "14px", 
                              fontWeight: "600",
                              color: stats.winRate >= 50 ? "var(--profit)" : "var(--loss)"
                            }}>
                              {stats.winRate.toFixed(1)}%
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Middle Panel - Strategy Details or Create New */}
      {(selectedStrategyData || isCreating) && (
        <div
          style={{
            flex: "1",
            display: "flex",
            flexDirection: "column",
            backgroundColor: "var(--bg-primary)",
            transition: "flex 0.2s",
            position: "relative",
          }}
        >

            {/* Header */}
            <div
              style={{
                padding: "20px",
                borderBottom: "1px solid var(--border-color)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <div
                  style={{
                    width: "12px",
                    height: "12px",
                    borderRadius: "50%",
                    backgroundColor: (isEditing || isCreating) ? editingFormData.color : (selectedStrategyData?.color || "var(--accent)"),
                  }}
                />
                {(isEditing || isCreating) ? (
                  <input
                    type="text"
                    value={editingFormData.name}
                    onChange={(e) => setEditingFormData({ ...editingFormData, name: e.target.value })}
                    placeholder="Strategy Name"
                    style={{
                      fontSize: "24px",
                      fontWeight: "bold",
                      background: "transparent",
                      border: "none",
                      borderBottom: "2px solid var(--accent)",
                      color: "var(--text-primary)",
                      padding: "4px 0",
                      outline: "none",
                    }}
                  />
                ) : (
                  <h2 style={{ fontSize: "24px", fontWeight: "bold" }}>{selectedStrategyData?.name}</h2>
                )}
              </div>
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
                {isCreating ? (
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      onClick={handleSaveNew}
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
                      onClick={handleCancelNew}
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
                ) : !isEditing ? (
                  <>
                    <button
                      onClick={handleEditClick}
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
                      onClick={() => selectedStrategyData && handleDelete(selectedStrategyData.id)}
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
                  </>
                ) : (
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      onClick={handleSaveEdit}
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
                      onClick={handleCancelEdit}
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
                )}
              </div>
            </div>

            {/* Name and Description - Editable when in edit/create mode */}
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-color)" }}>
              {(isEditing || isCreating) ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div>
                    <label style={{ display: "block", marginBottom: "6px", fontSize: "12px", fontWeight: "500" }}>
                      Description
                    </label>
                    <input
                      type="text"
                      value={editingFormData.description}
                      onChange={(e) => setEditingFormData({ ...editingFormData, description: e.target.value })}
                      placeholder="Strategy description..."
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
                      Color
                    </label>
                    <input
                      type="color"
                      value={editingFormData.color}
                      onChange={(e) => setEditingFormData({ ...editingFormData, color: e.target.value })}
                      style={{
                        width: "100%",
                        height: "36px",
                        border: "1px solid var(--border-color)",
                        borderRadius: "4px",
                        cursor: "pointer",
                      }}
                    />
                  </div>
                </div>
              ) : (
                <>
                  {selectedStrategyData?.description && (
                    <p style={{ color: "var(--text-secondary)", fontSize: "14px" }}>
                      {selectedStrategyData.description}
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Tabs */}
            <div
              style={{
                display: "flex",
                borderBottom: "1px solid var(--border-color)",
                backgroundColor: "var(--bg-secondary)",
              }}
            >
              {[
                { id: "notes" as TabType, label: "Details", icon: FileText },
                { id: "trades" as TabType, label: "View Trades", icon: TrendingUp, hideWhenCreating: true },
                { id: "checklists" as TabType, label: "Checklists", icon: ListChecks, hideWhenCreating: true },
              ].filter(tab => !(isCreating && tab.hideWhenCreating)).map((tab) => {
                const Icon = tab.icon;
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
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      fontSize: "14px",
                      fontWeight: isActive ? "600" : "400",
                      transition: "all 0.2s",
                    }}
                  >
                    <Icon size={16} />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Tab Content */}
            <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
              {activeTab === "notes" && (selectedStrategy !== null || isCreating) && (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", padding: "24px" }}>
                  <div style={{ marginBottom: "20px" }}>
                    <h3 style={{ 
                      fontSize: "20px", 
                      fontWeight: "600", 
                      marginBottom: "8px",
                      color: "var(--text-primary)"
                    }}>
                      Strategy Details
                    </h3>
                    <p style={{ 
                      fontSize: "13px", 
                      color: "var(--text-secondary)",
                      margin: 0
                    }}>
                      Document your trading strategy, rules, and insights with rich text formatting
                    </p>
                  </div>
                  <div style={{ 
                    flex: 1, 
                    display: "flex", 
                    flexDirection: "column", 
                    overflow: "hidden", 
                    minHeight: 0,
                    backgroundColor: "var(--bg-secondary)",
                    borderRadius: "8px",
                    padding: "1px"
                  }}>
                    <RichTextEditor
                      key={`${selectedStrategy || 'new'}-${isEditing ? 'edit' : 'view'}`}
                      value={isCreating ? newStrategyNotes : (notesContent.get(selectedStrategy || 0) || selectedStrategyData?.notes || "")}
                      onChange={(content: string) => handleNotesChange(isCreating ? null : selectedStrategy, content)}
                      placeholder="Start writing your strategy details... Use the toolbar above to format your text, add headings, lists, and more."
                      readOnly={!isEditing && !isCreating}
                    />
                  </div>
                </div>
              )}

              {activeTab === "trades" && (
                <div style={{ padding: "20px", overflowY: "auto" }}>
                  <h3 style={{ fontSize: "18px", fontWeight: "600", marginBottom: "16px" }}>Trades</h3>
                  {selectedStrategy && strategyStats.has(selectedStrategy) && (() => {
                    const stats = strategyStats.get(selectedStrategy)!;
                    return (
                      <div style={{
                        display: "flex",
                        gap: "32px",
                        marginBottom: "24px",
                        padding: "16px",
                        backgroundColor: "var(--bg-tertiary)",
                        borderRadius: "6px",
                        border: "1px solid var(--border-color)"
                      }}>
                        <div>
                          <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "4px", textTransform: "uppercase" }}>
                            TOTAL TRADES
                          </div>
                          <div style={{ fontSize: "20px", fontWeight: "600", color: "var(--text-primary)" }}>
                            {stats.totalTrades}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "4px", textTransform: "uppercase" }}>
                            TOTAL P&L
                          </div>
                          <div style={{ 
                            fontSize: "20px", 
                            fontWeight: "600",
                            color: stats.totalPnL >= 0 ? "var(--profit)" : "var(--loss)"
                          }}>
                            ${stats.totalPnL >= 0 ? "+" : ""}{stats.totalPnL.toFixed(2)}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "4px", textTransform: "uppercase" }}>
                            WIN %
                          </div>
                          <div style={{ 
                            fontSize: "20px", 
                            fontWeight: "600",
                            color: stats.winRate >= 50 ? "var(--profit)" : "var(--loss)"
                          }}>
                            {stats.winRate.toFixed(1)}%
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                  {isLoadingPairs ? (
                    <p style={{ color: "var(--text-secondary)", textAlign: "center", padding: "40px" }}>
                      Loading trades...
                    </p>
                  ) : pairs.length === 0 ? (
                    <p style={{ color: "var(--text-secondary)", textAlign: "center", padding: "40px" }}>
                      No trades found for this strategy.
                    </p>
                  ) : (
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ borderBottom: "1px solid var(--border-color)" }}>
                            <th
                              style={{
                                padding: "10px 12px",
                                textAlign: "left",
                                fontSize: "11px",
                                fontWeight: "600",
                                color: "var(--text-secondary)",
                                textTransform: "uppercase",
                              }}
                            >
                              Symbol
                            </th>
                            <th
                              style={{
                                padding: "10px 12px",
                                textAlign: "left",
                                fontSize: "11px",
                                fontWeight: "600",
                                color: "var(--text-secondary)",
                                textTransform: "uppercase",
                              }}
                            >
                              Entry Date
                            </th>
                            <th
                              style={{
                                padding: "10px 12px",
                                textAlign: "left",
                                fontSize: "11px",
                                fontWeight: "600",
                                color: "var(--text-secondary)",
                                textTransform: "uppercase",
                              }}
                            >
                              Exit Date
                            </th>
                            <th
                              style={{
                                padding: "10px 12px",
                                textAlign: "right",
                                fontSize: "11px",
                                fontWeight: "600",
                                color: "var(--text-secondary)",
                                textTransform: "uppercase",
                              }}
                            >
                              Quantity
                            </th>
                            <th
                              style={{
                                padding: "10px 12px",
                                textAlign: "right",
                                fontSize: "11px",
                                fontWeight: "600",
                                color: "var(--text-secondary)",
                                textTransform: "uppercase",
                              }}
                            >
                              Entry Price
                            </th>
                            <th
                              style={{
                                padding: "10px 12px",
                                textAlign: "right",
                                fontSize: "11px",
                                fontWeight: "600",
                                color: "var(--text-secondary)",
                                textTransform: "uppercase",
                              }}
                            >
                              Exit Price
                            </th>
                            <th
                              style={{
                                padding: "10px 12px",
                                textAlign: "right",
                                fontSize: "11px",
                                fontWeight: "600",
                                color: "var(--text-secondary)",
                                textTransform: "uppercase",
                              }}
                            >
                              P&L
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {pairs.map((pair, idx) => (
                            <tr
                              key={`${pair.entry_trade_id}-${pair.exit_trade_id}-${idx}`}
                              style={{ borderBottom: "1px solid var(--border-color)" }}
                            >
                              <td style={{ padding: "12px", fontSize: "14px" }}>{pair.symbol}</td>
                              <td style={{ padding: "12px", fontSize: "14px" }}>
                                {format(new Date(pair.entry_timestamp), "MMM dd, yyyy HH:mm")}
                              </td>
                              <td style={{ padding: "12px", fontSize: "14px" }}>
                                {format(new Date(pair.exit_timestamp), "MMM dd, yyyy HH:mm")}
                              </td>
                              <td style={{ padding: "12px", fontSize: "14px", textAlign: "right" }}>
                                {pair.quantity.toFixed(4)}
                              </td>
                              <td style={{ padding: "12px", fontSize: "14px", textAlign: "right" }}>
                                ${pair.entry_price.toFixed(2)}
                              </td>
                              <td style={{ padding: "12px", fontSize: "14px", textAlign: "right" }}>
                                ${pair.exit_price.toFixed(2)}
                              </td>
                              <td
                                style={{
                                  padding: "12px",
                                  fontSize: "14px",
                                  textAlign: "right",
                                  fontWeight: "600",
                                  color: pair.net_profit_loss >= 0 ? "var(--profit)" : "var(--loss)",
                                }}
                              >
                                ${pair.net_profit_loss.toFixed(2)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {activeTab === "checklists" && selectedStrategy && (
                <div style={{ padding: "20px", overflowY: "auto" }}>
                  <h3 style={{ fontSize: "18px", fontWeight: "600", marginBottom: "24px" }}>Checklists</h3>
                  
                  {(() => {
                    const currentChecklist = checklists.get(selectedStrategy) || { entry: [], takeProfit: [] };
                    
                    const handleDragEnd = (type: "entry" | "take_profit", event: DragEndEvent) => {
                      const { active, over } = event;
                      if (!over || active.id === over.id) return;
                      reorderChecklistItems(selectedStrategy, type, active.id as number, over.id as number);
                    };

                    const ChecklistSection = ({ type, title, items }: { type: "entry" | "take_profit"; title: string; items: ChecklistItem[] }) => {
                      const itemIds = items.map(item => item.id);
                      return (
                        <div style={{ marginBottom: "32px" }}>
                          <h4 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "16px", color: "var(--text-primary)" }}>
                            {title}
                          </h4>
                          <DndContext
                            sensors={sensors}
                            collisionDetection={closestCenter}
                            onDragEnd={(e) => handleDragEnd(type, e)}
                          >
                            <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
                              {items.map((item) => (
                                <SortableChecklistItem
                                  key={item.id}
                                  item={item}
                                  onDelete={() => deleteChecklistItem(selectedStrategy, item.id, type)}
                                />
                              ))}
                            </SortableContext>
                          </DndContext>
                          <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                            <input
                              type="text"
                              value={newChecklistItem[type === "entry" ? "entry" : "takeProfit"]}
                              onChange={(e) => setNewChecklistItem({
                                ...newChecklistItem,
                                [type === "entry" ? "entry" : "takeProfit"]: e.target.value,
                              })}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  addChecklistItem(selectedStrategy, type, newChecklistItem[type === "entry" ? "entry" : "takeProfit"]);
                                }
                              }}
                              placeholder={`Add ${title.toLowerCase()} item...`}
                              style={{
                                flex: 1,
                                padding: "10px",
                                backgroundColor: "var(--bg-secondary)",
                                border: "1px solid var(--border-color)",
                                borderRadius: "6px",
                                color: "var(--text-primary)",
                                fontSize: "14px",
                              }}
                            />
                            <button
                              onClick={() => addChecklistItem(selectedStrategy, type, newChecklistItem[type === "entry" ? "entry" : "takeProfit"])}
                              style={{
                                background: "var(--accent)",
                                border: "none",
                                borderRadius: "6px",
                                padding: "10px 16px",
                                color: "white",
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                gap: "6px",
                                fontSize: "14px",
                                fontWeight: "500",
                              }}
                            >
                              <Plus size={16} />
                              Add
                            </button>
                          </div>
                        </div>
                      );
                    };

                    return (
                      <div>
                        <ChecklistSection
                          type="entry"
                          title="Entry Checklist"
                          items={currentChecklist.entry}
                        />
                        <ChecklistSection
                          type="take_profit"
                          title="Take Profit Checklist"
                          items={currentChecklist.takeProfit}
                        />
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>
      )}

      {/* Right Panel - Empty State */}
      {!selectedStrategyData && !isCreating && (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "var(--bg-primary)",
            color: "var(--text-secondary)",
          }}
        >
          <div style={{ textAlign: "center" }}>
            <Target size={48} style={{ margin: "0 auto 16px", opacity: 0.3 }} />
            <p style={{ fontSize: "16px" }}>Select a strategy to view details</p>
          </div>
        </div>
      )}
    </div>
  );
}
