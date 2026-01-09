import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { Plus, Edit2, Trash2, FileText, X, Save, Image as ImageIcon, ChevronDown } from "lucide-react";
import { format } from "date-fns";
import RichTextEditor from "../components/RichTextEditor";

interface JournalEntry {
  id: number;
  date: string;
  title: string;
  trade: string | null;
  what_went_well: string | null;
  what_could_be_improved: string | null;
  emotional_state: string | null;
  notes: string | null;
  symbol: string | null;
  strategy_id: number | null;
  outcome: string | null;
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

type TabType = "trade" | "what_went_well" | "what_could_be_improved" | "emotional_state" | "notes";

export default function Journal() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>("trade");
  const [loading, setLoading] = useState(true);
  
  // Form state
  const [formData, setFormData] = useState({
    date: format(new Date(), "yyyy-MM-dd"),
    title: "",
    trade: "",
    what_went_well: "",
    what_could_be_improved: "",
    emotional_state: "",
    notes: "",
    symbol: "",
    strategy_id: null as number | null,
    outcome: "Positive",
  });

  // Checklist state
  const [strategyChecklists, setStrategyChecklists] = useState<Map<number, Map<string, ChecklistItem[]>>>(new Map());
  const [checklistResponses, setChecklistResponses] = useState<Map<number, boolean>>(new Map());

  useEffect(() => {
    loadEntries();
    loadStrategies();
  }, []);

  useEffect(() => {
    if (formData.strategy_id) {
      loadStrategyChecklists(formData.strategy_id);
    } else {
      setStrategyChecklists(new Map());
      setChecklistResponses(new Map());
    }
  }, [formData.strategy_id]);

  useEffect(() => {
    if (selectedEntry && !isCreating && !isEditing && selectedEntry.strategy_id) {
      loadChecklistResponses(selectedEntry.id);
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
      setChecklistResponses(new Map());
    } catch (error) {
      console.error("Error loading strategy checklists:", error);
    }
  };

  const loadChecklistResponses = async (entryId: number) => {
    try {
      const responses = await invoke<JournalChecklistResponse[]>("get_journal_checklist_responses", {
        journalEntryId: entryId,
      });

      const responseMap = new Map<number, boolean>();
      for (const response of responses) {
        responseMap.set(response.checklist_item_id, response.is_checked);
      }
      setChecklistResponses(responseMap);
    } catch (error) {
      console.error("Error loading checklist responses:", error);
    }
  };

  const handleCreateNew = () => {
    setIsCreating(true);
    setIsEditing(false);
    setSelectedEntry(null);
    setFormData({
      date: format(new Date(), "yyyy-MM-dd"),
      title: "",
      trade: "",
      what_went_well: "",
      what_could_be_improved: "",
      emotional_state: "",
      notes: "",
      symbol: "",
      strategy_id: null,
      outcome: "Positive",
    });
    setActiveTab("trade");
    setChecklistResponses(new Map());
  };

  const handleEdit = async () => {
    if (selectedEntry) {
      setIsEditing(true);
      setIsCreating(false);
      setFormData({
        date: selectedEntry.date,
        title: selectedEntry.title,
        trade: selectedEntry.trade || "",
        what_went_well: selectedEntry.what_went_well || "",
        what_could_be_improved: selectedEntry.what_could_be_improved || "",
        emotional_state: selectedEntry.emotional_state || "",
        notes: selectedEntry.notes || "",
        symbol: selectedEntry.symbol || "",
        strategy_id: selectedEntry.strategy_id,
        outcome: selectedEntry.outcome || "Positive",
      });
      setActiveTab("trade");
      if (selectedEntry.strategy_id) {
        await loadStrategyChecklists(selectedEntry.strategy_id);
        await loadChecklistResponses(selectedEntry.id);
      }
    }
  };

  const handleDelete = async () => {
    if (selectedEntry && window.confirm(`Are you sure you want to delete "${selectedEntry.title}"?`)) {
      try {
        await invoke("delete_journal_entry", { id: selectedEntry.id });
        await loadEntries();
        setSelectedEntry(null);
      } catch (error) {
        console.error("Error deleting entry:", error);
        alert("Failed to delete entry: " + error);
      }
    }
  };

  const handleSave = async () => {
    if (!formData.title.trim()) {
      alert("Please enter a title");
      return;
    }

    try {
      let entryId: number;

      if (isCreating) {
        entryId = await invoke<number>("create_journal_entry", {
          date: formData.date,
          title: formData.title,
          trade: formData.trade || null,
          whatWentWell: formData.what_went_well || null,
          whatCouldBeImproved: formData.what_could_be_improved || null,
          emotionalState: formData.emotional_state || null,
          notes: formData.notes || null,
          symbol: formData.symbol || null,
          strategyId: formData.strategy_id,
          outcome: formData.outcome || null,
        });
      } else if (selectedEntry) {
        entryId = selectedEntry.id;
        await invoke("update_journal_entry", {
          id: selectedEntry.id,
          date: formData.date,
          title: formData.title,
          trade: formData.trade || null,
          whatWentWell: formData.what_went_well || null,
          whatCouldBeImproved: formData.what_could_be_improved || null,
          emotionalState: formData.emotional_state || null,
          notes: formData.notes || null,
          symbol: formData.symbol || null,
          strategyId: formData.strategy_id,
          outcome: formData.outcome || null,
        });
      } else {
        return;
      }

      // Save checklist responses
      if (formData.strategy_id) {
        const checklists = strategyChecklists.get(formData.strategy_id);
        if (checklists) {
          const responses: [number, boolean][] = [];
          for (const [type, items] of checklists.entries()) {
            for (const item of items) {
              const isChecked = checklistResponses.get(item.id) || false;
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
      setIsCreating(false);
      setIsEditing(false);
    } catch (error) {
      console.error("Error saving entry:", error);
      alert("Failed to save entry: " + error);
    }
  };

  const handleCancel = () => {
    setIsCreating(false);
    setIsEditing(false);
    if (selectedEntry) {
      // Reload the entry to reset form
      loadEntry(selectedEntry.id);
    }
  };

  const loadEntry = async (id: number) => {
    try {
      const entry = await invoke<JournalEntry>("get_journal_entry", { id });
      setSelectedEntry(entry);
      if (entry.strategy_id) {
        await loadStrategyChecklists(entry.strategy_id);
        await loadChecklistResponses(entry.id);
      }
    } catch (error) {
      console.error("Error loading entry:", error);
    }
  };

  const toggleChecklistItem = (itemId: number) => {
    setChecklistResponses(prev => {
      const newMap = new Map(prev);
      const current = newMap.get(itemId) || false;
      newMap.set(itemId, !current);
      return newMap;
    });
  };

  const getChecklistTitle = (type: string): string => {
    const titleMap: Record<string, string> = {
      "entry": "Entry Checklist",
      "take_profit": "Take Profit Checklist",
      "review": "Review Checklist",
    };
    return titleMap[type] || type.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') + " Checklist";
  };

  const calculateProgress = (): number => {
    if (!formData.strategy_id) return 0;
    const checklists = strategyChecklists.get(formData.strategy_id);
    if (!checklists) return 0;

    let total = 0;
    let checked = 0;

    for (const items of checklists.values()) {
      for (const item of items) {
        total++;
        if (checklistResponses.get(item.id)) {
          checked++;
        }
      }
    }

    return total > 0 ? Math.round((checked / total) * 100) : 0;
  };

  const selectedStrategy = strategies.find(s => s.id === formData.strategy_id);
  const currentChecklists = formData.strategy_id ? strategyChecklists.get(formData.strategy_id) : null;
  const defaultTypes = ["entry", "take_profit", "review"];
  const customTypes = currentChecklists 
    ? Array.from(currentChecklists.keys()).filter(t => !defaultTypes.includes(t))
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
            <div style={{ padding: "24px", borderBottom: "1px solid var(--border-color)" }}>
              <h2 style={{ fontSize: "24px", fontWeight: "bold", marginBottom: "8px" }}>
                {format(new Date(selectedEntry.date), "MM/dd/yyyy")} - {selectedEntry.title}
              </h2>
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
                {selectedEntry.trade && (
                  <div>
                    <label style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: "4px", display: "block" }}>
                      Trade
                    </label>
                    <div style={{ color: "var(--text-primary)", fontSize: "14px", whiteSpace: "pre-wrap" }}>
                      {selectedEntry.trade}
                    </div>
                  </div>
                )}
                {selectedEntry.what_went_well && (
                  <div>
                    <label style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: "4px", display: "block" }}>
                      What Went Well
                    </label>
                    <div style={{ color: "var(--text-primary)", fontSize: "14px", whiteSpace: "pre-wrap" }}>
                      {selectedEntry.what_went_well}
                    </div>
                  </div>
                )}
                {selectedEntry.what_could_be_improved && (
                  <div>
                    <label style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: "4px", display: "block" }}>
                      What Could Be Improved
                    </label>
                    <div style={{ color: "var(--text-primary)", fontSize: "14px", whiteSpace: "pre-wrap" }}>
                      {selectedEntry.what_could_be_improved}
                    </div>
                  </div>
                )}
                {selectedEntry.emotional_state && (
                  <div>
                    <label style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: "4px", display: "block" }}>
                      Emotional State
                    </label>
                    <div style={{ color: "var(--text-primary)", fontSize: "14px", whiteSpace: "pre-wrap" }}>
                      {selectedEntry.emotional_state}
                    </div>
                  </div>
                )}
                {selectedEntry.notes && (
                  <div>
                    <label style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: "4px", display: "block" }}>
                      Notes
                    </label>
                    <div style={{ color: "var(--text-primary)", fontSize: "14px", whiteSpace: "pre-wrap" }}>
                      {selectedEntry.notes}
                    </div>
                  </div>
                )}
                {selectedEntry.symbol && (
                  <div>
                    <label style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: "4px", display: "block" }}>
                      Symbol
                    </label>
                    <div style={{ color: "var(--text-primary)", fontSize: "14px" }}>
                      {selectedEntry.symbol}
                    </div>
                  </div>
                )}
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
                {selectedEntry.outcome && (
                  <div>
                    <label style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: "4px", display: "block" }}>
                      Outcome
                    </label>
                    <div style={{ color: "var(--text-primary)", fontSize: "14px" }}>
                      {selectedEntry.outcome}
                    </div>
                  </div>
                )}
                {selectedEntry.strategy_id && (() => {
                  const checklists = strategyChecklists.get(selectedEntry.strategy_id);
                  if (!checklists || checklists.size === 0) return null;

                  const defaultTypes = ["entry", "take_profit", "review"];
                  const customTypes = Array.from(checklists.keys()).filter(t => !defaultTypes.includes(t));
                  const allTypes = [...defaultTypes, ...customTypes.filter(t => !defaultTypes.includes(t))];

                  return (
                    <div style={{ marginTop: "24px" }}>
                      <h3 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "16px", color: "var(--text-primary)" }}>
                        Checklist Responses
                      </h3>
                      {allTypes.map((type) => {
                        const items = checklists.get(type) || [];
                        if (items.length === 0) return null;

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

                        return (
                          <div key={type} style={{ marginBottom: "24px" }}>
                            <h4 style={{ fontSize: "14px", fontWeight: "600", marginBottom: "12px", color: "var(--text-primary)" }}>
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
                                  {children.map((child) => {
                                    const isChecked = checklistResponses.get(child.id) || false;
                                    return (
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
                                          checked={isChecked}
                                          disabled
                                          style={{
                                            cursor: "not-allowed",
                                            width: "16px",
                                            height: "16px",
                                          }}
                                        />
                                        <label
                                          style={{
                                            flex: 1,
                                            fontSize: "14px",
                                            color: isChecked ? "var(--text-primary)" : "var(--text-secondary)",
                                            textDecoration: isChecked ? "none" : "line-through",
                                            opacity: isChecked ? 1 : 0.6,
                                          }}
                                        >
                                          {child.item_text}
                                        </label>
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })}
                            {/* Render regular items */}
                            {regularItems.map((item) => {
                              const isChecked = checklistResponses.get(item.id) || false;
                              return (
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
                                    checked={isChecked}
                                    disabled
                                    style={{
                                      cursor: "not-allowed",
                                      width: "16px",
                                      height: "16px",
                                    }}
                                  />
                                  <label
                                    style={{
                                      flex: 1,
                                      fontSize: "14px",
                                      color: isChecked ? "var(--text-primary)" : "var(--text-secondary)",
                                      textDecoration: isChecked ? "none" : "line-through",
                                      opacity: isChecked ? 1 : 0.6,
                                    }}
                                  >
                                    {item.item_text}
                                  </label>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </div>
          </>
        ) : (isCreating || isEditing) ? (
          <>
            <div style={{ padding: "20px", borderBottom: "1px solid var(--border-color)" }}>
              <h2 style={{ fontSize: "20px", fontWeight: "bold" }}>Journal Entry</h2>
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
                      value={formData.date}
                      onChange={(e) => setFormData({ ...formData, date: e.target.value })}
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
                      type="text"
                      value={formData.title}
                      onChange={(e) => setFormData({ ...formData, title: e.target.value })}
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
                      Symbol
                    </label>
                    <input
                      type="text"
                      value={formData.symbol}
                      onChange={(e) => setFormData({ ...formData, symbol: e.target.value })}
                      placeholder="Symbol..."
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
                      value={formData.strategy_id || ""}
                      onChange={(e) => setFormData({ ...formData, strategy_id: e.target.value ? parseInt(e.target.value) : null })}
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
                  <div>
                    <label style={{ display: "block", marginBottom: "6px", fontSize: "12px", fontWeight: "500" }}>
                      Outcome
                    </label>
                    <select
                      value={formData.outcome}
                      onChange={(e) => setFormData({ ...formData, outcome: e.target.value })}
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
                      <option value="Positive">Positive</option>
                      <option value="Negative">Negative</option>
                      <option value="Neutral">Neutral</option>
                    </select>
                  </div>
                </div>
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
                  { id: "trade" as TabType, label: "Trade" },
                  { id: "what_went_well" as TabType, label: "What Went Well" },
                  { id: "what_could_be_improved" as TabType, label: "What Could Be Improved" },
                  { id: "emotional_state" as TabType, label: "Emotional State" },
                  { id: "notes" as TabType, label: "Notes" },
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
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "16px" }}>
                    <textarea
                      value={formData.trade}
                      onChange={(e) => setFormData({ ...formData, trade: e.target.value })}
                      placeholder="Describe the related trades..."
                      style={{
                        flex: 1,
                        padding: "12px",
                        backgroundColor: "var(--bg-secondary)",
                        border: "1px solid var(--border-color)",
                        borderRadius: "6px",
                        color: "var(--text-primary)",
                        fontSize: "14px",
                        fontFamily: "inherit",
                        resize: "none",
                        minHeight: "200px",
                      }}
                    />
                    {formData.strategy_id && currentChecklists && (
                      <div style={{ marginTop: "20px" }}>
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
                                          checked={checklistResponses.get(child.id) || false}
                                          onChange={() => toggleChecklistItem(child.id)}
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
                                          onClick={() => toggleChecklistItem(child.id)}
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
                                    checked={checklistResponses.get(item.id) || false}
                                    onChange={() => toggleChecklistItem(item.id)}
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
                                    onClick={() => toggleChecklistItem(item.id)}
                                  >
                                    {item.item_text}
                                  </label>
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
                {activeTab === "what_went_well" && (
                  <textarea
                    value={formData.what_went_well}
                    onChange={(e) => setFormData({ ...formData, what_went_well: e.target.value })}
                    placeholder="What went well..."
                    style={{
                      flex: 1,
                      padding: "12px",
                      backgroundColor: "var(--bg-secondary)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "6px",
                      color: "var(--text-primary)",
                      fontSize: "14px",
                      fontFamily: "inherit",
                      resize: "none",
                      minHeight: "200px",
                    }}
                  />
                )}
                {activeTab === "what_could_be_improved" && (
                  <textarea
                    value={formData.what_could_be_improved}
                    onChange={(e) => setFormData({ ...formData, what_could_be_improved: e.target.value })}
                    placeholder="What could be improved..."
                    style={{
                      flex: 1,
                      padding: "12px",
                      backgroundColor: "var(--bg-secondary)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "6px",
                      color: "var(--text-primary)",
                      fontSize: "14px",
                      fontFamily: "inherit",
                      resize: "none",
                      minHeight: "200px",
                    }}
                  />
                )}
                {activeTab === "emotional_state" && (
                  <textarea
                    value={formData.emotional_state}
                    onChange={(e) => setFormData({ ...formData, emotional_state: e.target.value })}
                    placeholder="Emotional state..."
                    style={{
                      flex: 1,
                      padding: "12px",
                      backgroundColor: "var(--bg-secondary)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "6px",
                      color: "var(--text-primary)",
                      fontSize: "14px",
                      fontFamily: "inherit",
                      resize: "none",
                      minHeight: "200px",
                    }}
                  />
                )}
                {activeTab === "notes" && (
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                    <RichTextEditor
                      value={formData.notes}
                      onChange={(content: string) => setFormData({ ...formData, notes: content })}
                      placeholder="Notes..."
                      readOnly={false}
                    />
                  </div>
                )}
              </div>

              {/* Save Button */}
              <div style={{ padding: "20px", borderTop: "1px solid var(--border-color)", display: "flex", justifyContent: "center" }}>
                <button
                  onClick={handleSave}
                  style={{
                    background: "var(--accent)",
                    border: "none",
                    borderRadius: "6px",
                    padding: "10px 24px",
                    color: "white",
                    cursor: "pointer",
                    fontSize: "14px",
                    fontWeight: "500",
                  }}
                >
                  <Save size={16} style={{ marginRight: "8px", verticalAlign: "middle" }} />
                  Save
                </button>
              </div>
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
          width: "300px",
          borderLeft: "1px solid var(--border-color)",
          display: "flex",
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
                      {format(new Date(entry.date), "MM/dd/yyyy")} - {entry.title}
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
          {(isCreating || isEditing) && formData.strategy_id && (
            <div style={{ marginBottom: "12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>Checklist Progress</span>
                <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>{calculateProgress()}%</span>
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
                    width: `${calculateProgress()}%`,
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
            {selectedEntry && !isCreating && !isEditing && (
              <>
                <button
                  onClick={handleEdit}
                  style={{
                    width: "100%",
                    padding: "10px",
                    backgroundColor: "var(--bg-tertiary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "6px",
                    color: "var(--text-primary)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                    fontSize: "14px",
                    fontWeight: "500",
                  }}
                >
                  <Edit2 size={16} />
                  Edit Entry
                </button>
                <button
                  onClick={handleDelete}
                  style={{
                    width: "100%",
                    padding: "10px",
                    backgroundColor: "var(--bg-tertiary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "6px",
                    color: "var(--danger)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                    fontSize: "14px",
                    fontWeight: "500",
                  }}
                >
                  <Trash2 size={16} />
                  Delete Entry
                </button>
              </>
            )}
            {isCreating || isEditing ? (
              <button
                onClick={handleCancel}
                style={{
                  width: "100%",
                  padding: "10px",
                  backgroundColor: "var(--bg-tertiary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px",
                  color: "var(--text-primary)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                  fontSize: "14px",
                  fontWeight: "500",
                }}
              >
                <X size={16} />
                Cancel
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
