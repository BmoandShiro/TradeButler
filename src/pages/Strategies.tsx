import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { Plus, Edit2, Trash2, Target, ChevronDown, ChevronRight } from "lucide-react";
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
    }
    setExpandedStrategies(newExpanded);
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
                  <div style={{ display: "flex", gap: "8px" }}>
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

