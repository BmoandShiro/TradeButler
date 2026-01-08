import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { Plus, Edit2, Trash2, Target, ChevronDown, ChevronRight, CheckSquare, X } from "lucide-react";
import { format } from "date-fns";

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

interface ChecklistItem {
  id: number | null;
  strategy_id: number;
  item_text: string;
  is_checked: boolean;
  item_order: number;
}

export default function Strategies() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingStrategy, setEditingStrategy] = useState<Strategy | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    notes: "",
    color: "#3b82f6",
  });
  const [expandedStrategies, setExpandedStrategies] = useState<Set<number>>(new Set());
  const [strategyPairs, setStrategyPairs] = useState<Map<number, PairedTrade[]>>(new Map());
  const [loadingPairs, setLoadingPairs] = useState<Set<number>>(new Set());
  const [strategyChecklists, setStrategyChecklists] = useState<Map<number, ChecklistItem[]>>(new Map());
  const [showChecklistForStrategy, setShowChecklistForStrategy] = useState<number | null>(null);
  const [editingChecklistItem, setEditingChecklistItem] = useState<ChecklistItem | null>(null);
  const [newChecklistItemText, setNewChecklistItemText] = useState("");

  useEffect(() => {
    loadStrategies();
  }, []);

  const loadStrategies = async () => {
    try {
      const data = await invoke<Strategy[]>("get_strategies");
      setStrategies(data);
    } catch (error) {
      console.error("Error loading strategies:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingStrategy) {
        await invoke("update_strategy", {
          id: editingStrategy.id,
          name: formData.name,
          description: formData.description || null,
          notes: formData.notes || null,
          color: formData.color || null,
        });
      } else {
        await invoke("create_strategy", {
          name: formData.name,
          description: formData.description || null,
          notes: formData.notes || null,
          color: formData.color || null,
        });
      }
      resetForm();
      loadStrategies();
    } catch (error) {
      console.error("Error saving strategy:", error);
      alert("Failed to save strategy: " + error);
    }
  };

  const handleEdit = (strategy: Strategy) => {
    setEditingStrategy(strategy);
    setFormData({
      name: strategy.name,
      description: strategy.description || "",
      notes: strategy.notes || "",
      color: strategy.color || "#3b82f6",
    });
    setShowForm(true);
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Are you sure you want to delete this strategy? Trades using this strategy will be unassigned.")) {
      return;
    }
    try {
      await invoke("delete_strategy", { id });
      loadStrategies();
    } catch (error) {
      console.error("Error deleting strategy:", error);
      alert("Failed to delete strategy: " + error);
    }
  };

  const resetForm = () => {
    setFormData({ name: "", description: "", notes: "", color: "#3b82f6" });
    setEditingStrategy(null);
    setShowForm(false);
  };

  const toggleStrategyExpansion = async (strategyId: number) => {
    const newExpanded = new Set(expandedStrategies);
    if (newExpanded.has(strategyId)) {
      newExpanded.delete(strategyId);
    } else {
      newExpanded.add(strategyId);
      // Load pairs if not already loaded
      if (!strategyPairs.has(strategyId)) {
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
        } catch (error) {
          console.error("Error loading strategy pairs:", error);
        } finally {
          const newLoading = new Set(loadingPairs);
          newLoading.delete(strategyId);
          setLoadingPairs(newLoading);
        }
      }
      // Load checklist if not already loaded
      if (!strategyChecklists.has(strategyId)) {
        try {
          const checklist = await invoke<ChecklistItem[]>("get_strategy_checklist", {
            strategyId: strategyId,
          });
          setStrategyChecklists(new Map(strategyChecklists.set(strategyId, checklist)));
        } catch (error) {
          console.error("Error loading strategy checklist:", error);
        }
      }
    }
    setExpandedStrategies(newExpanded);
  };

  const loadChecklist = async (strategyId: number) => {
    try {
      const checklist = await invoke<ChecklistItem[]>("get_strategy_checklist", {
        strategyId: strategyId,
      });
      setStrategyChecklists(new Map(strategyChecklists.set(strategyId, checklist)));
    } catch (error) {
      console.error("Error loading strategy checklist:", error);
    }
  };

  const handleChecklistToggle = async (item: ChecklistItem) => {
    try {
      await invoke("save_strategy_checklist_item", {
        id: item.id,
        strategyId: item.strategy_id,
        itemText: item.item_text,
        isChecked: !item.is_checked,
        itemOrder: item.item_order,
      });
      await loadChecklist(item.strategy_id);
    } catch (error) {
      console.error("Error updating checklist item:", error);
    }
  };

  const handleAddChecklistItem = async (strategyId: number) => {
    if (!newChecklistItemText.trim()) return;
    
    try {
      const checklist = strategyChecklists.get(strategyId) || [];
      const maxOrder = checklist.length > 0 
        ? Math.max(...checklist.map(item => item.item_order)) 
        : -1;
      
      await invoke("save_strategy_checklist_item", {
        id: null,
        strategyId: strategyId,
        itemText: newChecklistItemText.trim(),
        isChecked: false,
        itemOrder: maxOrder + 1,
      });
      setNewChecklistItemText("");
      await loadChecklist(strategyId);
    } catch (error) {
      console.error("Error adding checklist item:", error);
    }
  };

  const handleEditChecklistItem = async (item: ChecklistItem, newText: string) => {
    if (!newText.trim()) return;
    
    try {
      await invoke("save_strategy_checklist_item", {
        id: item.id,
        strategyId: item.strategy_id,
        itemText: newText.trim(),
        isChecked: item.is_checked,
        itemOrder: item.item_order,
      });
      setEditingChecklistItem(null);
      await loadChecklist(item.strategy_id);
    } catch (error) {
      console.error("Error updating checklist item:", error);
    }
  };

  const handleDeleteChecklistItem = async (item: ChecklistItem) => {
    if (!item.id) return;
    
    try {
      await invoke("delete_strategy_checklist_item", { id: item.id });
      await loadChecklist(item.strategy_id);
    } catch (error) {
      console.error("Error deleting checklist item:", error);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: "40px", textAlign: "center" }}>
        <p>Loading strategies...</p>
      </div>
    );
  }

  return (
    <div style={{ padding: "30px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "30px",
        }}
      >
        <h1 style={{ fontSize: "32px", fontWeight: "bold" }}>Strategies</h1>
        <button
          onClick={() => setShowForm(true)}
          style={{
            background: "var(--accent)",
            border: "none",
            borderRadius: "8px",
            padding: "10px 16px",
            color: "white",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "14px",
            fontWeight: "500",
          }}
        >
          <Plus size={16} />
          New Strategy
        </button>
      </div>

      {showForm && (
        <div
          style={{
            backgroundColor: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            borderRadius: "8px",
            padding: "20px",
            marginBottom: "30px",
          }}
        >
          <h2 style={{ fontSize: "20px", fontWeight: "600", marginBottom: "16px" }}>
            {editingStrategy ? "Edit Strategy" : "Create Strategy"}
          </h2>
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div>
              <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: "500" }}>
                Name *
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
                style={{
                  width: "100%",
                  padding: "10px",
                  backgroundColor: "var(--bg-tertiary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px",
                  color: "var(--text-primary)",
                  fontSize: "14px",
                }}
              />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: "500" }}>
                Description
              </label>
              <input
                type="text"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                style={{
                  width: "100%",
                  padding: "10px",
                  backgroundColor: "var(--bg-tertiary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px",
                  color: "var(--text-primary)",
                  fontSize: "14px",
                }}
              />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: "500" }}>
                Notes
              </label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={4}
                style={{
                  width: "100%",
                  padding: "10px",
                  backgroundColor: "var(--bg-tertiary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px",
                  color: "var(--text-primary)",
                  fontSize: "14px",
                  resize: "vertical",
                }}
              />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: "500" }}>
                Color
              </label>
              <input
                type="color"
                value={formData.color}
                onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                style={{
                  width: "100px",
                  height: "40px",
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px",
                  cursor: "pointer",
                }}
              />
            </div>
            <div style={{ display: "flex", gap: "12px" }}>
              <button
                type="submit"
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
                {editingStrategy ? "Update" : "Create"}
              </button>
              <button
                type="button"
                onClick={resetForm}
                style={{
                  background: "var(--bg-tertiary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px",
                  padding: "10px 20px",
                  color: "var(--text-primary)",
                  cursor: "pointer",
                  fontSize: "14px",
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {strategies.length === 0 ? (
        <div
          style={{
            backgroundColor: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            borderRadius: "8px",
            padding: "40px",
            textAlign: "center",
          }}
        >
          <Target size={48} style={{ margin: "0 auto 16px", opacity: 0.5 }} />
          <p style={{ color: "var(--text-secondary)", marginBottom: "16px" }}>
            No strategies yet. Create your first strategy to organize your trades.
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: "16px" }}>
          {strategies.map((strategy) => {
            const isExpanded = expandedStrategies.has(strategy.id);
            const pairs = strategyPairs.get(strategy.id) || [];
            const isLoading = loadingPairs.has(strategy.id);
            
            // Calculate statistics from pairs
            const totalTrades = pairs.length;
            const totalPnL = pairs.reduce((sum, pair) => sum + pair.net_profit_loss, 0);
            const winningTrades = pairs.filter(pair => pair.net_profit_loss > 0).length;
            const winPercentage = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
            
            return (
              <div
                key={strategy.id}
                style={{
                  backgroundColor: "var(--bg-secondary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "8px",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    padding: "20px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
                      <button
                        onClick={() => toggleStrategyExpansion(strategy.id)}
                        style={{
                          background: "none",
                          border: "none",
                          padding: "0",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          color: "var(--text-primary)",
                        }}
                      >
                        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </button>
                      <div
                        style={{
                          width: "12px",
                          height: "12px",
                          borderRadius: "50%",
                          backgroundColor: strategy.color || "var(--accent)",
                        }}
                      />
                      <h3 style={{ fontSize: "18px", fontWeight: "600" }}>{strategy.name}</h3>
                    </div>
                    
                    {/* Statistics row */}
                    {!isLoading && pairs.length > 0 && (
                      <div style={{ 
                        display: "flex", 
                        gap: "24px", 
                        marginTop: "12px",
                        marginLeft: "28px",
                        flexWrap: "wrap"
                      }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                          <span style={{ fontSize: "11px", color: "var(--text-secondary)", textTransform: "uppercase", fontWeight: "500" }}>
                            Total Trades
                          </span>
                          <span style={{ fontSize: "16px", fontWeight: "600", color: "var(--text-primary)" }}>
                            {totalTrades}
                          </span>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                          <span style={{ fontSize: "11px", color: "var(--text-secondary)", textTransform: "uppercase", fontWeight: "500" }}>
                            Total P&L
                          </span>
                          <span style={{ 
                            fontSize: "16px", 
                            fontWeight: "600", 
                            color: totalPnL >= 0 ? "var(--profit)" : "var(--loss)" 
                          }}>
                            ${totalPnL >= 0 ? "+" : ""}{totalPnL.toFixed(2)}
                          </span>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                          <span style={{ fontSize: "11px", color: "var(--text-secondary)", textTransform: "uppercase", fontWeight: "500" }}>
                            Win %
                          </span>
                          <span style={{ 
                            fontSize: "16px", 
                            fontWeight: "600", 
                            color: winPercentage >= 50 ? "var(--profit)" : winPercentage > 0 ? "var(--text-primary)" : "var(--loss)"
                          }}>
                            {winPercentage.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                    )}
                    {strategy.description && (
                      <p style={{ color: "var(--text-secondary)", marginBottom: "8px", fontSize: "14px" }}>
                        {strategy.description}
                      </p>
                    )}
                    {strategy.notes && (
                      <p style={{ color: "var(--text-secondary)", fontSize: "13px", fontStyle: "italic" }}>
                        {strategy.notes}
                      </p>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <select
                      value={showChecklistForStrategy === strategy.id ? "checklist" : "trades"}
                      onChange={(e) => {
                        if (e.target.value === "checklist") {
                          setShowChecklistForStrategy(strategy.id);
                          if (!strategyChecklists.has(strategy.id)) {
                            loadChecklist(strategy.id);
                          }
                        } else {
                          setShowChecklistForStrategy(null);
                        }
                      }}
                      style={{
                        padding: "6px 12px",
                        backgroundColor: "var(--bg-tertiary)",
                        border: "1px solid var(--border-color)",
                        borderRadius: "6px",
                        color: "var(--text-primary)",
                        fontSize: "13px",
                        cursor: "pointer",
                      }}
                    >
                      <option value="trades">View Trades</option>
                      <option value="checklist">Strategy Checklist</option>
                    </select>
                    <button
                      onClick={() => handleEdit(strategy)}
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
                    >
                      <Edit2 size={16} />
                    </button>
                    <button
                      onClick={() => handleDelete(strategy.id)}
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
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                {isExpanded && (
                  <div
                    style={{
                      borderTop: "1px solid var(--border-color)",
                      padding: "20px",
                      backgroundColor: "var(--bg-tertiary)",
                    }}
                  >
                    {showChecklistForStrategy === strategy.id ? (
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
                          <CheckSquare size={20} style={{ color: "var(--accent)" }} />
                          <h3 style={{ fontSize: "16px", fontWeight: "600" }}>Strategy Checklist</h3>
                        </div>
                        <div style={{ marginBottom: "16px" }}>
                          <div style={{ display: "flex", gap: "8px" }}>
                            <input
                              type="text"
                              value={newChecklistItemText}
                              onChange={(e) => setNewChecklistItemText(e.target.value)}
                              onKeyPress={(e) => {
                                if (e.key === "Enter") {
                                  handleAddChecklistItem(strategy.id);
                                }
                              }}
                              placeholder="Add a new checklist item..."
                              style={{
                                flex: 1,
                                padding: "8px 12px",
                                backgroundColor: "var(--bg-secondary)",
                                border: "1px solid var(--border-color)",
                                borderRadius: "6px",
                                color: "var(--text-primary)",
                                fontSize: "14px",
                              }}
                            />
                            <button
                              onClick={() => handleAddChecklistItem(strategy.id)}
                              style={{
                                background: "var(--accent)",
                                border: "none",
                                borderRadius: "6px",
                                padding: "8px 16px",
                                color: "white",
                                cursor: "pointer",
                                fontSize: "14px",
                                fontWeight: "500",
                                display: "flex",
                                alignItems: "center",
                                gap: "6px",
                              }}
                            >
                              <Plus size={16} />
                              Add
                            </button>
                          </div>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                          {(strategyChecklists.get(strategy.id) || []).map((item) => (
                            <div
                              key={item.id || `temp-${item.item_order}`}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "12px",
                                padding: "12px",
                                backgroundColor: "var(--bg-secondary)",
                                border: "1px solid var(--border-color)",
                                borderRadius: "6px",
                              }}
                            >
                              <div
                                onClick={() => handleChecklistToggle(item)}
                                style={{
                                  width: "20px",
                                  height: "20px",
                                  minWidth: "20px",
                                  border: "2px solid var(--border-color)",
                                  borderRadius: "4px",
                                  backgroundColor: item.is_checked ? "var(--accent)" : "var(--bg-tertiary)",
                                  cursor: "pointer",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  transition: "all 0.2s ease",
                                  position: "relative",
                                }}
                              >
                                {item.is_checked && (
                                  <svg
                                    width="12"
                                    height="12"
                                    viewBox="0 0 12 12"
                                    fill="none"
                                    xmlns="http://www.w3.org/2000/svg"
                                  >
                                    <path
                                      d="M10 3L4.5 8.5L2 6"
                                      stroke="white"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                )}
                              </div>
                              {editingChecklistItem?.id === item.id ? (
                                <div style={{ flex: 1, display: "flex", gap: "8px", alignItems: "center" }}>
                                  <input
                                    type="text"
                                    defaultValue={item.item_text}
                                    onBlur={(e) => {
                                      if (e.target.value.trim() && e.target.value !== item.item_text) {
                                        handleEditChecklistItem(item, e.target.value);
                                      } else {
                                        setEditingChecklistItem(null);
                                      }
                                    }}
                                    onKeyPress={(e) => {
                                      if (e.key === "Enter") {
                                        const newText = (e.target as HTMLInputElement).value;
                                        if (newText.trim() && newText !== item.item_text) {
                                          handleEditChecklistItem(item, newText);
                                        } else {
                                          setEditingChecklistItem(null);
                                        }
                                      } else if (e.key === "Escape") {
                                        setEditingChecklistItem(null);
                                      }
                                    }}
                                    autoFocus
                                    style={{
                                      flex: 1,
                                      padding: "6px 10px",
                                      backgroundColor: "var(--bg-tertiary)",
                                      border: "1px solid var(--accent)",
                                      borderRadius: "4px",
                                      color: "var(--text-primary)",
                                      fontSize: "14px",
                                    }}
                                  />
                                  <button
                                    onClick={() => setEditingChecklistItem(null)}
                                    style={{
                                      background: "none",
                                      border: "none",
                                      color: "var(--text-secondary)",
                                      cursor: "pointer",
                                      padding: "4px",
                                      display: "flex",
                                      alignItems: "center",
                                    }}
                                  >
                                    <X size={16} />
                                  </button>
                                </div>
                              ) : (
                                <>
                                  <span
                                    style={{
                                      flex: 1,
                                      fontSize: "14px",
                                      textDecoration: item.is_checked ? "line-through" : "none",
                                      opacity: item.is_checked ? 0.6 : 1,
                                      color: item.is_checked ? "var(--text-secondary)" : "var(--text-primary)",
                                      cursor: "pointer",
                                    }}
                                    onClick={() => setEditingChecklistItem(item)}
                                  >
                                    {item.item_text}
                                  </span>
                                  <div style={{ display: "flex", gap: "4px" }}>
                                    <button
                                      onClick={() => setEditingChecklistItem(item)}
                                      style={{
                                        background: "none",
                                        border: "none",
                                        color: "var(--text-secondary)",
                                        cursor: "pointer",
                                        padding: "4px",
                                        display: "flex",
                                        alignItems: "center",
                                      }}
                                      title="Edit"
                                    >
                                      <Edit2 size={14} />
                                    </button>
                                    <button
                                      onClick={() => handleDeleteChecklistItem(item)}
                                      style={{
                                        background: "none",
                                        border: "none",
                                        color: "var(--danger)",
                                        cursor: "pointer",
                                        padding: "4px",
                                        display: "flex",
                                        alignItems: "center",
                                      }}
                                      title="Delete"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          ))}
                          {(!strategyChecklists.get(strategy.id) || strategyChecklists.get(strategy.id)!.length === 0) && (
                            <p style={{ color: "var(--text-secondary)", textAlign: "center", padding: "20px", fontSize: "14px" }}>
                              No checklist items yet. Add one above to get started.
                            </p>
                          )}
                        </div>
                      </div>
                    ) : (
                      <>
                        {isLoading ? (
                          <p style={{ color: "var(--text-secondary)", textAlign: "center" }}>Loading trade pairs...</p>
                        ) : pairs.length === 0 ? (
                          <p style={{ color: "var(--text-secondary)", textAlign: "center" }}>No trade pairs found for this strategy.</p>
                        ) : (
                          <div style={{ overflowX: "auto" }}>
                            <table style={{ width: "100%", borderCollapse: "collapse" }}>
                              <thead>
                                <tr style={{ borderBottom: "1px solid var(--border-color)" }}>
                                  <th style={{ padding: "8px 12px", textAlign: "left", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                                    Symbol
                                  </th>
                                  <th style={{ padding: "8px 12px", textAlign: "left", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                                    Entry Date
                                  </th>
                                  <th style={{ padding: "8px 12px", textAlign: "left", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                                    Exit Date
                                  </th>
                                  <th style={{ padding: "8px 12px", textAlign: "right", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                                    Quantity
                                  </th>
                                  <th style={{ padding: "8px 12px", textAlign: "right", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                                    Entry Price
                                  </th>
                                  <th style={{ padding: "8px 12px", textAlign: "right", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                                    Exit Price
                                  </th>
                                  <th style={{ padding: "8px 12px", textAlign: "right", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                                    P&L
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {pairs.map((pair, idx) => (
                                  <tr key={`${pair.entry_trade_id}-${pair.exit_trade_id}-${idx}`} style={{ borderBottom: "1px solid var(--border-color)" }}>
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
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

