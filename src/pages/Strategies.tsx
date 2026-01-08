import { useEffect, useState, Dispatch, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { Plus, Edit2, Trash2, Target, Maximize2, Minimize2, FileText, TrendingUp, ListChecks, GripVertical, X, FolderPlus, ChevronDown, ChevronUp, Folder, ChevronRight } from "lucide-react";
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
  parent_id: number | null;
}

function SortableChecklistItem({ 
  item, 
  onDelete, 
  isEditing, 
  isSelected, 
  onSelect,
  onEdit,
  isEditingText,
  editingText,
  onEditingTextChange,
  onSaveEdit,
  onCancelEdit,
  isGroup = false
}: { 
  item: ChecklistItem; 
  onDelete: () => void; 
  isEditing: boolean;
  isSelected: boolean;
  onSelect: (selected: boolean) => void;
  onEdit: () => void;
  isEditingText: boolean;
  editingText: string;
  onEditingTextChange: (text: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  isGroup?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled: !isEditing || isEditingText });

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
        gap: isGroup ? "10px" : "8px",
        padding: isGroup ? "14px 16px" : "12px 14px",
        backgroundColor: isSelected ? "var(--accent)" : (isGroup ? "var(--bg-secondary)" : "var(--bg-tertiary)"),
        border: isGroup 
          ? `2px solid ${isSelected ? "var(--accent)" : "var(--accent)"}`
          : `1px solid ${isSelected ? "var(--accent)" : "var(--border-color)"}`,
        borderRadius: isGroup ? "8px" : "6px",
        marginBottom: isGroup ? "12px" : "8px",
        marginLeft: item.parent_id ? "0" : "0",
        boxShadow: isGroup 
          ? (isSelected ? "0 2px 8px rgba(0, 0, 0, 0.2)" : "0 1px 4px rgba(0, 0, 0, 0.1)")
          : "none",
      }}
    >
      {isEditing && !isEditingText && (
        <>
          <input
            type="checkbox"
            checked={isSelected}
            onChange={(e) => onSelect(e.target.checked)}
            onClick={(e) => e.stopPropagation()}
            style={{
              cursor: "pointer",
              width: "16px",
              height: "16px",
            }}
          />
          <div
            {...attributes}
            {...listeners}
            style={{
              cursor: "grab",
              color: isSelected ? "white" : "var(--text-secondary)",
              display: "flex",
              alignItems: "center",
            }}
          >
            <GripVertical size={16} />
          </div>
        </>
      )}
      {isGroup && !isEditingText && (
        <Folder size={18} style={{ color: isSelected ? "white" : "var(--accent)", flexShrink: 0 }} />
      )}
      {isEditingText ? (
        <input
          type="text"
          value={editingText}
          onChange={(e) => onEditingTextChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onSaveEdit();
            } else if (e.key === "Escape") {
              onCancelEdit();
            }
          }}
          onBlur={onSaveEdit}
          autoFocus
          style={{
            flex: 1,
            padding: "6px 8px",
            backgroundColor: "var(--bg-primary)",
            border: "1px solid var(--accent)",
            borderRadius: "4px",
            color: "var(--text-primary)",
            fontSize: isGroup ? "15px" : "14px",
            fontWeight: isGroup ? "600" : "400",
            outline: "none",
          }}
        />
      ) : (
        <div 
          style={{ 
            flex: 1, 
            fontSize: isGroup ? "15px" : "14px",
            fontWeight: isGroup ? "600" : "400",
            color: isSelected ? "white" : "var(--text-primary)",
            cursor: isEditing ? "text" : "default",
          }}
          onClick={isEditing ? onEdit : undefined}
          title={isEditing ? "Click to edit" : undefined}
        >
          {item.item_text}
        </div>
      )}
      {isEditing && !isEditingText && (
        <button
          onClick={onDelete}
          style={{
            background: "transparent",
            border: "none",
            color: isSelected ? "white" : "var(--danger)",
            cursor: "pointer",
            padding: "4px",
            display: "flex",
            alignItems: "center",
          }}
          title="Delete"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}

function ChecklistSection({ 
  type, 
  title, 
  items,
  selectedStrategy,
  isEditing,
  newChecklistItem,
  setNewChecklistItem,
  selectedChecklistItems,
  setSelectedChecklistItems,
  editingItemId,
  editingItemText,
  setEditingItemText,
  sensors,
  onDragEnd,
  deleteChecklistItem,
  startEditingItem,
  saveEditedItem,
  cancelEditingItem,
  addChecklistItem,
  setPendingGroupAction,
  setGroupName,
  setShowGroupModal,
  ungroupChecklistItems,
  isCustom,
  onDeleteChecklist,
}: { 
  type: string; 
  title: string; 
  items: ChecklistItem[];
  selectedStrategy: number;
  isEditing: boolean;
  newChecklistItem: Map<string, string>;
  setNewChecklistItem: Dispatch<SetStateAction<Map<string, string>>>;
  selectedChecklistItems: Set<number>;
  setSelectedChecklistItems: Dispatch<SetStateAction<Set<number>>>;
  editingItemId: number | null;
  editingItemText: string;
  setEditingItemText: Dispatch<SetStateAction<string>>;
  sensors: ReturnType<typeof useSensors>;
  onDragEnd: (type: string, event: DragEndEvent) => void;
  deleteChecklistItem: (strategyId: number, itemId: number, type: string) => void;
  startEditingItem: (item: ChecklistItem) => void;
  saveEditedItem: (itemId: number, newText: string) => Promise<void>;
  cancelEditingItem: () => void;
  addChecklistItem: (strategyId: number, type: string, text: string) => Promise<void>;
  setPendingGroupAction: Dispatch<SetStateAction<{ strategyId: number; type: string; itemIds: number[] } | null>>;
  setGroupName: Dispatch<SetStateAction<string>>;
  setShowGroupModal: Dispatch<SetStateAction<boolean>>;
  ungroupChecklistItems: (itemIds: number[]) => Promise<void>;
  isCustom: boolean;
  onDeleteChecklist?: () => void;
}) {
  // Organize items: groups (items with no parent_id that have children) and regular items
  const itemIdsSet = new Set(items.map(item => item.id));
  const groups = items.filter(item => !item.parent_id && items.some(child => child.parent_id === item.id));
  const regularItems = items.filter(item => !item.parent_id && !items.some(child => child.parent_id === item.id));
  const groupedItems = items.filter(item => item.parent_id !== null && itemIdsSet.has(item.parent_id));
  
  // Organize by parent
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
  
  const itemIds = items.map(item => item.id);
  const currentValue = newChecklistItem.get(type) || "";
  const selectedItems = Array.from(selectedChecklistItems);
  const hasSelection = selectedItems.length > 0;
  
  const handleToggleSelect = (itemId: number, selected: boolean) => {
    setSelectedChecklistItems(prev => {
      const newSet = new Set(prev);
      if (selected) {
        newSet.add(itemId);
      } else {
        newSet.delete(itemId);
      }
      return newSet;
    });
  };
  
  const handleGroupSelected = () => {
    setPendingGroupAction({ strategyId: selectedStrategy, type, itemIds: selectedItems });
    setGroupName("");
    setShowGroupModal(true);
  };
  
  const handleUngroupSelected = () => {
    ungroupChecklistItems(selectedItems);
  };
  
  return (
    <div style={{ marginBottom: "40px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px", paddingBottom: "12px", borderBottom: "2px solid var(--border-color)" }}>
        <h4 style={{ fontSize: "18px", fontWeight: "700", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px" }}>
          <ListChecks size={18} style={{ color: "var(--accent)" }} />
          {title}
        </h4>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {isEditing && hasSelection && (
            <>
              <button
                onClick={handleGroupSelected}
                style={{
                  background: "var(--accent)",
                  border: "none",
                  borderRadius: "6px",
                  padding: "6px 12px",
                  color: "white",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "12px",
                  fontWeight: "500",
                }}
                title="Group Selected"
              >
                <FolderPlus size={14} />
                Group ({selectedItems.length})
              </button>
              <button
                onClick={handleUngroupSelected}
                style={{
                  background: "var(--bg-tertiary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px",
                  padding: "6px 12px",
                  color: "var(--text-primary)",
                  cursor: "pointer",
                  fontSize: "12px",
                  fontWeight: "500",
                }}
                title="Ungroup Selected"
              >
                Ungroup
              </button>
            </>
          )}
          {isEditing && isCustom && onDeleteChecklist && (
            <button
              onClick={onDeleteChecklist}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--danger)",
                cursor: "pointer",
                padding: "4px",
                display: "flex",
                alignItems: "center",
              }}
              title="Delete Checklist"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>
      {isEditing ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={(e) => onDragEnd(type, e)}
        >
          <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
            {/* Render groups with their children */}
            {groups.map((group) => {
              const children = itemsByParent.get(group.id) || [];
              return (
                <div key={group.id} style={{ marginBottom: "20px", position: "relative" }}>
                  {/* Group Header - Enhanced styling */}
                  <SortableChecklistItem
                    item={group}
                    onDelete={() => deleteChecklistItem(selectedStrategy, group.id, type)}
                    isEditing={isEditing}
                    isSelected={selectedChecklistItems.has(group.id)}
                    onSelect={(selected) => handleToggleSelect(group.id, selected)}
                    onEdit={() => startEditingItem(group)}
                    isEditingText={editingItemId === group.id}
                    editingText={editingItemText}
                    onEditingTextChange={setEditingItemText}
                    onSaveEdit={() => saveEditedItem(group.id, editingItemText)}
                    onCancelEdit={cancelEditingItem}
                    isGroup={true}
                  />
                  {/* Group Children - with visual connection */}
                  {children.length > 0 && (
                    <div style={{ 
                      position: "relative", 
                      marginLeft: "20px", 
                      paddingLeft: "24px", 
                      borderLeft: "2px solid var(--accent)",
                      opacity: 0.6,
                    }}>
                      {children.map((child, index) => (
                        <div key={child.id} style={{ position: "relative" }}>
                          {index < children.length - 1 && (
                            <div style={{
                              position: "absolute",
                              left: "-26px",
                              top: "24px",
                              width: "2px",
                              height: "calc(100% + 8px)",
                              backgroundColor: "var(--accent)",
                              opacity: 0.4,
                            }} />
                          )}
                          <SortableChecklistItem
                            item={child}
                            onDelete={() => deleteChecklistItem(selectedStrategy, child.id, type)}
                            isEditing={isEditing}
                            isSelected={selectedChecklistItems.has(child.id)}
                            onSelect={(selected) => handleToggleSelect(child.id, selected)}
                            onEdit={() => startEditingItem(child)}
                            isEditingText={editingItemId === child.id}
                            editingText={editingItemText}
                            onEditingTextChange={setEditingItemText}
                            onSaveEdit={() => saveEditedItem(child.id, editingItemText)}
                            onCancelEdit={cancelEditingItem}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {/* Render regular (ungrouped) items */}
            {regularItems.length > 0 && (
              <div style={{ marginTop: regularItems.length > 0 && groups.length > 0 ? "24px" : "0" }}>
                {regularItems.map((item) => (
                  <SortableChecklistItem
                    key={item.id}
                    item={item}
                    onDelete={() => deleteChecklistItem(selectedStrategy, item.id, type)}
                    isEditing={isEditing}
                    isSelected={selectedChecklistItems.has(item.id)}
                    onSelect={(selected) => handleToggleSelect(item.id, selected)}
                    onEdit={() => startEditingItem(item)}
                    isEditingText={editingItemId === item.id}
                    editingText={editingItemText}
                    onEditingTextChange={setEditingItemText}
                    onSaveEdit={() => saveEditedItem(item.id, editingItemText)}
                    onCancelEdit={cancelEditingItem}
                  />
                ))}
              </div>
            )}
          </SortableContext>
        </DndContext>
      ) : (
        <div>
          {/* Render groups with their children in view mode */}
          {groups.map((group) => {
            const children = itemsByParent.get(group.id) || [];
            return (
              <div key={group.id} style={{ marginBottom: "20px", position: "relative" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    padding: "14px 16px",
                    backgroundColor: "var(--bg-secondary)",
                    border: "2px solid var(--accent)",
                    borderRadius: "8px",
                    marginBottom: "12px",
                    fontWeight: "600",
                    boxShadow: "0 1px 4px rgba(0, 0, 0, 0.1)",
                  }}
                >
                  <Folder size={18} style={{ color: "var(--accent)", flexShrink: 0 }} />
                  <div style={{ flex: 1, fontSize: "15px", fontWeight: "600", color: "var(--text-primary)" }}>
                    {group.item_text}
                  </div>
                </div>
                {children.length > 0 && (
                  <div style={{ 
                    position: "relative", 
                    marginLeft: "20px", 
                    paddingLeft: "24px", 
                    borderLeft: "2px solid var(--accent)",
                    opacity: 0.6,
                  }}>
                    {children.map((child, index) => (
                      <div key={child.id} style={{ position: "relative" }}>
                        {index < children.length - 1 && (
                          <div style={{
                            position: "absolute",
                            left: "-26px",
                            top: "24px",
                            width: "2px",
                            height: "calc(100% + 8px)",
                            backgroundColor: "var(--accent)",
                            opacity: 0.4,
                          }} />
                        )}
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            padding: "12px 14px",
                            backgroundColor: "var(--bg-tertiary)",
                            border: "1px solid var(--border-color)",
                            borderRadius: "6px",
                            marginBottom: "8px",
                          }}
                        >
                          <ChevronRight size={14} style={{ color: "var(--text-secondary)", opacity: 0.5 }} />
                          <div style={{ flex: 1, fontSize: "14px", color: "var(--text-primary)" }}>
                            {child.item_text}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
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
                padding: "12px 14px",
                backgroundColor: "var(--bg-tertiary)",
                border: "1px solid var(--border-color)",
                borderRadius: "6px",
                marginBottom: "8px",
              }}
            >
              <div style={{ flex: 1, fontSize: "14px", color: "var(--text-primary)" }}>
                {item.item_text}
              </div>
            </div>
          ))}
        </div>
      )}
      {isEditing && (
        <div style={{ 
          display: "flex", 
          gap: "10px", 
          marginTop: "16px",
          padding: "16px",
          backgroundColor: "var(--bg-secondary)",
          borderRadius: "8px",
          border: "1px dashed var(--border-color)",
        }}>
          <input
            type="text"
            value={currentValue}
            onChange={(e) => {
              const newValue = e.target.value;
              setNewChecklistItem(prev => {
                const newMap = new Map(prev);
                newMap.set(type, newValue);
                return newMap;
              });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                addChecklistItem(selectedStrategy, type, currentValue);
              }
            }}
            placeholder={`Add ${title.toLowerCase()} item...`}
            style={{
              flex: 1,
              padding: "12px 14px",
              backgroundColor: "var(--bg-primary)",
              border: "1px solid var(--border-color)",
              borderRadius: "6px",
              color: "var(--text-primary)",
              fontSize: "14px",
              outline: "none",
              transition: "border-color 0.2s",
            }}
            onFocus={(e) => e.target.style.borderColor = "var(--accent)"}
            onBlur={(e) => e.target.style.borderColor = "var(--border-color)"}
          />
          <button
            onClick={() => addChecklistItem(selectedStrategy, type, currentValue)}
            style={{
              background: "var(--accent)",
              border: "none",
              borderRadius: "6px",
              padding: "12px 20px",
              color: "white",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "14px",
              fontWeight: "600",
              transition: "opacity 0.2s, transform 0.2s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = "0.9";
              e.currentTarget.style.transform = "translateY(-1px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = "1";
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            <Plus size={16} />
            Add
          </button>
        </div>
      )}
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
  const [checklists, setChecklists] = useState<Map<number, Map<string, ChecklistItem[]>>>(new Map());
  const [newChecklistItem, setNewChecklistItem] = useState<Map<string, string>>(new Map());
  const [selectedChecklistItems, setSelectedChecklistItems] = useState<Set<number>>(new Set());
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [pendingGroupAction, setPendingGroupAction] = useState<{ strategyId: number; type: string; itemIds: number[] } | null>(null);
  const [customChecklistTypes, setCustomChecklistTypes] = useState<Map<number, Set<string>>>(new Map());
  const [showNewChecklistModal, setShowNewChecklistModal] = useState(false);
  const [newChecklistName, setNewChecklistName] = useState("");
  const [expandedStats, setExpandedStats] = useState<Set<number>>(new Set());
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [editingItemText, setEditingItemText] = useState<string>("");
  
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
      // Load all checklist items for this strategy (pass null to get all types)
      const allItems = await invoke<ChecklistItem[]>("get_strategy_checklist", {
        strategyId: strategyId,
        checklistType: null,
      });
      
      // Default checklist types - always include these even if empty
      const defaultTypes = ["entry", "take_profit", "review"];
      const checklistMap = new Map<string, ChecklistItem[]>();
      const customTypesSet = new Set<string>();
      
      // Initialize default types
      for (const type of defaultTypes) {
        checklistMap.set(type, []);
      }
      
      // Group items by type
      for (const item of allItems) {
        const type = item.checklist_type;
        if (!checklistMap.has(type)) {
          checklistMap.set(type, []);
          if (!defaultTypes.includes(type)) {
            customTypesSet.add(type);
          }
        }
        checklistMap.get(type)!.push(item);
      }
      
      setChecklists(new Map(checklists.set(strategyId, checklistMap)));
      setCustomChecklistTypes(new Map(customChecklistTypes.set(strategyId, customTypesSet)));
    } catch (error) {
      console.error("Error loading checklists:", error);
      // Fallback to default structure
      const checklistMap = new Map<string, ChecklistItem[]>();
      checklistMap.set("entry", []);
      checklistMap.set("take_profit", []);
      checklistMap.set("review", []);
      setChecklists(new Map(checklists.set(strategyId, checklistMap)));
      setCustomChecklistTypes(new Map(customChecklistTypes.set(strategyId, new Set())));
    }
  };

  const addChecklistItem = async (strategyId: number, type: string, text: string) => {
    if (!text.trim()) return;
    try {
      const currentChecklist = checklists.get(strategyId) || new Map<string, ChecklistItem[]>();
      const items = currentChecklist.get(type) || [];
      const maxOrder = items.length > 0 ? Math.max(...items.map(i => i.item_order)) : -1;
      
      const newId = await invoke<number>("save_strategy_checklist_item", {
        id: null,
        strategyId: strategyId,
        itemText: text.trim(),
        isChecked: false,
        itemOrder: maxOrder + 1,
        checklistType: type,
        parentId: null,
      });

      const newItem: ChecklistItem = {
        id: newId,
        strategy_id: strategyId,
        item_text: text.trim(),
        is_checked: false,
        item_order: maxOrder + 1,
        checklist_type: type,
        parent_id: null,
      };

      const updatedChecklist = new Map(currentChecklist);
      updatedChecklist.set(type, [...items, newItem]);
      setChecklists(new Map(checklists.set(strategyId, updatedChecklist)));
      // Clear the input field for this type
      setNewChecklistItem(prev => {
        const newMap = new Map(prev);
        newMap.set(type, "");
        return newMap;
      });
    } catch (error) {
      console.error("Error adding checklist item:", error);
      alert("Failed to add checklist item: " + error);
    }
  };

  const deleteChecklistItem = async (strategyId: number, itemId: number, type: string) => {
    try {
      await invoke("delete_strategy_checklist_item", { id: itemId });
      const currentChecklist = checklists.get(strategyId) || new Map<string, ChecklistItem[]>();
      const items = currentChecklist.get(type) || [];
      const updatedItems = items.filter(item => item.id !== itemId);
      const updatedChecklist = new Map(currentChecklist);
      updatedChecklist.set(type, updatedItems);
      setChecklists(new Map(checklists.set(strategyId, updatedChecklist)));
    } catch (error) {
      console.error("Error deleting checklist item:", error);
      alert("Failed to delete checklist item: " + error);
    }
  };

  const deleteChecklistType = async (strategyId: number, type: string) => {
    const defaultTypes = ["entry", "take_profit", "review"];
    if (defaultTypes.includes(type)) {
      alert("Cannot delete default checklist types (Entry, Take Profit, or Review)");
      return;
    }

    if (!confirm(`Are you sure you want to delete the "${type.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')} Checklist"? This will delete all items in this checklist.`)) {
      return;
    }

    try {
      const currentChecklist = checklists.get(strategyId) || new Map<string, ChecklistItem[]>();
      const items = currentChecklist.get(type) || [];
      
      // Delete all items in this checklist type
      for (const item of items) {
        if (item.id) {
          await invoke("delete_strategy_checklist_item", { id: item.id });
        }
      }

      // Remove the checklist type from state
      const updatedChecklist = new Map(currentChecklist);
      updatedChecklist.delete(type);
      setChecklists(new Map(checklists.set(strategyId, updatedChecklist)));

      // Remove from custom types
      const customTypesSet = new Set(customChecklistTypes.get(strategyId) || []);
      customTypesSet.delete(type);
      setCustomChecklistTypes(new Map(customChecklistTypes.set(strategyId, customTypesSet)));

      // Clear the input field for this type
      setNewChecklistItem(prev => {
        const newMap = new Map(prev);
        newMap.delete(type);
        return newMap;
      });
    } catch (error) {
      console.error("Error deleting checklist type:", error);
      alert("Failed to delete checklist: " + error);
    }
  };

  const groupChecklistItems = async (strategyId: number, type: string, itemIds: number[], groupName: string) => {
    if (itemIds.length === 0 || !groupName.trim()) return;
    try {
      await invoke<number>("group_checklist_items", {
        itemIds: itemIds,
        groupName: groupName.trim(),
        strategyId: strategyId,
        checklistType: type,
      });
      setSelectedChecklistItems(new Set());
      setShowGroupModal(false);
      setGroupName("");
      setPendingGroupAction(null);
      await loadChecklists(strategyId);
    } catch (error) {
      console.error("Error grouping checklist items:", error);
      alert("Failed to group checklist items: " + error);
    }
  };

  const handleGroupModalSubmit = () => {
    if (pendingGroupAction) {
      groupChecklistItems(
        pendingGroupAction.strategyId,
        pendingGroupAction.type,
        pendingGroupAction.itemIds,
        groupName
      );
    }
  };

  const handleGroupModalCancel = () => {
    setShowGroupModal(false);
    setGroupName("");
    setPendingGroupAction(null);
  };

  const ungroupChecklistItems = async (itemIds: number[]) => {
    if (itemIds.length === 0) return;
    try {
      await invoke("ungroup_checklist_items", { itemIds: itemIds });
      setSelectedChecklistItems(new Set());
      if (selectedStrategy) {
        await loadChecklists(selectedStrategy);
      }
    } catch (error) {
      console.error("Error ungrouping checklist items:", error);
      alert("Failed to ungroup checklist items: " + error);
    }
  };

  const startEditingItem = (item: ChecklistItem) => {
    setEditingItemId(item.id);
    setEditingItemText(item.item_text);
  };

  const saveEditedItem = async (itemId: number, newText: string) => {
    if (!newText.trim()) {
      setEditingItemId(null);
      setEditingItemText("");
      return;
    }
    
    try {
      const checklistMap = checklists.get(selectedStrategy || 0) || new Map<string, ChecklistItem[]>();
      const allItems: ChecklistItem[] = [];
      for (const items of checklistMap.values()) {
        allItems.push(...items);
      }
      const item = allItems.find(i => i.id === itemId);
      if (item && selectedStrategy) {
        await invoke("save_strategy_checklist_item", {
          id: itemId,
          strategyId: selectedStrategy,
          itemText: newText.trim(),
          isChecked: item.is_checked,
          itemOrder: item.item_order,
          checklistType: item.checklist_type,
          parentId: item.parent_id,
        });
        await loadChecklists(selectedStrategy);
      }
    } catch (error) {
      console.error("Error saving checklist item:", error);
      alert("Failed to save checklist item: " + error);
    } finally {
      setEditingItemId(null);
      setEditingItemText("");
    }
  };

  const cancelEditingItem = () => {
    setEditingItemId(null);
    setEditingItemText("");
  };

  const reorderChecklistItems = async (strategyId: number, type: string, activeId: number, overId: number) => {
    const currentChecklist = checklists.get(strategyId) || new Map<string, ChecklistItem[]>();
    const items = currentChecklist.get(type) || [];
    
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
          parentId: item.parent_id,
        });
      }
    } catch (error) {
      console.error("Error reordering checklist items:", error);
      alert("Failed to reorder checklist items: " + error);
      return;
    }

    const updatedChecklist = new Map(currentChecklist);
    updatedChecklist.set(type, updatedItems);
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
                      const hasTrades = stats.totalTrades > 0;
                      const isCollapsed = expandedStats.has(strategy.id); // expandedStats tracks collapsed state (inverted)
                      
                      if (!hasTrades) {
                        return null;
                      }
                      
                      const toggleStats = (e: React.MouseEvent) => {
                        e.stopPropagation();
                        setExpandedStats(prev => {
                          const newSet = new Set(prev);
                          if (newSet.has(strategy.id!)) {
                            newSet.delete(strategy.id!);
                          } else {
                            newSet.add(strategy.id!);
                          }
                          return newSet;
                        });
                      };
                      
                      return (
                        <div>
                          <div 
                            style={{ 
                              display: "flex", 
                              alignItems: "center", 
                              justifyContent: "space-between",
                              marginTop: "8px",
                              paddingTop: "8px",
                              borderTop: `1px solid ${isSelected ? "rgba(255,255,255,0.2)" : "var(--border-color)"}`
                            }}
                          >
                            <button
                              onClick={toggleStats}
                              style={{
                                background: "transparent",
                                border: "none",
                                color: isSelected ? "rgba(255,255,255,0.7)" : "var(--text-secondary)",
                                cursor: "pointer",
                                padding: "2px",
                                display: "flex",
                                alignItems: "center",
                                transition: "transform 0.2s",
                              }}
                              title={isCollapsed ? "Show stats" : "Hide stats"}
                            >
                              {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                            </button>
                          </div>
                          {!isCollapsed && (
                            <div style={{ 
                              display: "flex", 
                              gap: "16px", 
                              marginTop: "8px",
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
                          )}
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

              {activeTab === "checklists" && selectedStrategy && (() => {
                const currentChecklist = checklists.get(selectedStrategy) || new Map<string, ChecklistItem[]>();
                
                const handleDragEnd = (type: string, event: DragEndEvent) => {
                  const { active, over } = event;
                  if (!over || active.id === over.id) return;
                  reorderChecklistItems(selectedStrategy, type, active.id as number, over.id as number);
                };

                // Helper function to get display title for checklist type
                const getChecklistTitle = (type: string): string => {
                  const titleMap: Record<string, string> = {
                    "entry": "Entry Checklist",
                    "take_profit": "Take Profit Checklist",
                    "review": "Review Checklist",
                  };
                  return titleMap[type] || type.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') + " Checklist";
                };

                // Get all checklist types in order: default types first, then custom
                const defaultTypes = ["entry", "take_profit", "review"];
                const customTypes = Array.from(customChecklistTypes.get(selectedStrategy) || []);
                const allTypes = [...defaultTypes, ...customTypes.filter(t => !defaultTypes.includes(t))];

                return (
                  <div style={{ padding: "24px", overflowY: "auto" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "32px", paddingBottom: "16px", borderBottom: "1px solid var(--border-color)" }}>
                      <h2 style={{ fontSize: "24px", fontWeight: "700", color: "var(--text-primary)", margin: 0 }}>
                        Checklists
                      </h2>
                      {isEditing && (
                        <button
                          onClick={() => setShowNewChecklistModal(true)}
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
                          New Checklist
                        </button>
                      )}
                    </div>
                    <div>
                      {allTypes.map((type) => {
                        const isCustom = !defaultTypes.includes(type);
                        return (
                          <ChecklistSection
                            key={type}
                            type={type}
                            title={getChecklistTitle(type)}
                            items={currentChecklist.get(type) || []}
                            selectedStrategy={selectedStrategy}
                            isEditing={isEditing}
                            newChecklistItem={newChecklistItem}
                            setNewChecklistItem={setNewChecklistItem}
                            selectedChecklistItems={selectedChecklistItems}
                            setSelectedChecklistItems={setSelectedChecklistItems}
                            editingItemId={editingItemId}
                            editingItemText={editingItemText}
                            setEditingItemText={setEditingItemText}
                            sensors={sensors}
                            onDragEnd={handleDragEnd}
                            deleteChecklistItem={deleteChecklistItem}
                            startEditingItem={startEditingItem}
                            saveEditedItem={saveEditedItem}
                            cancelEditingItem={cancelEditingItem}
                            addChecklistItem={addChecklistItem}
                            setPendingGroupAction={setPendingGroupAction}
                            setGroupName={setGroupName}
                            setShowGroupModal={setShowGroupModal}
                            ungroupChecklistItems={ungroupChecklistItems}
                            isCustom={isCustom}
                            onDeleteChecklist={isCustom ? () => deleteChecklistType(selectedStrategy, type) : undefined}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
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

      {/* Group Name Modal */}
      {showGroupModal && (
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
          onClick={handleGroupModalCancel}
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
                marginBottom: "16px",
                color: "var(--text-primary)",
              }}
            >
              Create Group
            </h3>
            <p
              style={{
                fontSize: "14px",
                color: "var(--text-secondary)",
                marginBottom: "16px",
              }}
            >
              Enter a name for the group:
            </p>
            <input
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && groupName.trim()) {
                  handleGroupModalSubmit();
                } else if (e.key === "Escape") {
                  handleGroupModalCancel();
                }
              }}
              placeholder="Group name..."
              autoFocus
              style={{
                width: "100%",
                padding: "12px",
                backgroundColor: "var(--bg-primary)",
                border: "1px solid var(--border-color)",
                borderRadius: "6px",
                color: "var(--text-primary)",
                fontSize: "14px",
                marginBottom: "20px",
                outline: "none",
              }}
            />
            <div
              style={{
                display: "flex",
                gap: "12px",
                justifyContent: "flex-end",
              }}
            >
              <button
                onClick={handleGroupModalCancel}
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
                onClick={handleGroupModalSubmit}
                disabled={!groupName.trim()}
                style={{
                  background: groupName.trim() ? "var(--accent)" : "var(--bg-tertiary)",
                  border: "none",
                  borderRadius: "6px",
                  padding: "10px 20px",
                  color: groupName.trim() ? "white" : "var(--text-secondary)",
                  cursor: groupName.trim() ? "pointer" : "not-allowed",
                  fontSize: "14px",
                  fontWeight: "500",
                  opacity: groupName.trim() ? 1 : 0.6,
                }}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Checklist Modal */}
      {showNewChecklistModal && (
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
          onClick={() => {
            setShowNewChecklistModal(false);
            setNewChecklistName("");
          }}
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
                marginBottom: "16px",
                color: "var(--text-primary)",
              }}
            >
              Create New Checklist
            </h3>
            <p
              style={{
                fontSize: "14px",
                color: "var(--text-secondary)",
                marginBottom: "16px",
              }}
            >
              Enter a name for the new checklist section:
            </p>
            <input
              type="text"
              value={newChecklistName}
              onChange={(e) => setNewChecklistName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newChecklistName.trim()) {
                  if (selectedStrategy) {
                    const currentChecklist = checklists.get(selectedStrategy) || new Map<string, ChecklistItem[]>();
                    const typeName = newChecklistName.trim().toLowerCase().replace(/\s+/g, '_');
                    
                    // Initialize the checklist type in the map
                    const updatedChecklist = new Map(currentChecklist);
                    if (!updatedChecklist.has(typeName)) {
                      updatedChecklist.set(typeName, []);
                    }
                    setChecklists(new Map(checklists.set(selectedStrategy, updatedChecklist)));
                    
                    // Add to custom types
                    const customTypesSet = new Set(customChecklistTypes.get(selectedStrategy) || []);
                    customTypesSet.add(typeName);
                    setCustomChecklistTypes(new Map(customChecklistTypes.set(selectedStrategy, customTypesSet)));
                    
                    setNewChecklistName("");
                    setShowNewChecklistModal(false);
                  }
                } else if (e.key === "Escape") {
                  setShowNewChecklistModal(false);
                  setNewChecklistName("");
                }
              }}
              placeholder="Checklist name..."
              autoFocus
              style={{
                width: "100%",
                padding: "12px",
                backgroundColor: "var(--bg-primary)",
                border: "1px solid var(--border-color)",
                borderRadius: "6px",
                color: "var(--text-primary)",
                fontSize: "14px",
                marginBottom: "20px",
                outline: "none",
              }}
            />
            <div
              style={{
                display: "flex",
                gap: "12px",
                justifyContent: "flex-end",
              }}
            >
              <button
                onClick={() => {
                  setShowNewChecklistModal(false);
                  setNewChecklistName("");
                }}
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
                onClick={() => {
                  if (selectedStrategy && newChecklistName.trim()) {
                    const currentChecklist = checklists.get(selectedStrategy) || new Map<string, ChecklistItem[]>();
                    const typeName = newChecklistName.trim().toLowerCase().replace(/\s+/g, '_');
                    
                    // Initialize the checklist type in the map
                    const updatedChecklist = new Map(currentChecklist);
                    if (!updatedChecklist.has(typeName)) {
                      updatedChecklist.set(typeName, []);
                    }
                    setChecklists(new Map(checklists.set(selectedStrategy, updatedChecklist)));
                    
                    // Add to custom types
                    const customTypesSet = new Set(customChecklistTypes.get(selectedStrategy) || []);
                    customTypesSet.add(typeName);
                    setCustomChecklistTypes(new Map(customChecklistTypes.set(selectedStrategy, customTypesSet)));
                    
                    setNewChecklistName("");
                    setShowNewChecklistModal(false);
                  }
                }}
                disabled={!newChecklistName.trim()}
                style={{
                  background: newChecklistName.trim() ? "var(--accent)" : "var(--bg-tertiary)",
                  border: "none",
                  borderRadius: "6px",
                  padding: "10px 20px",
                  color: newChecklistName.trim() ? "white" : "var(--text-secondary)",
                  cursor: newChecklistName.trim() ? "pointer" : "not-allowed",
                  fontSize: "14px",
                  fontWeight: "500",
                  opacity: newChecklistName.trim() ? 1 : 0.6,
                }}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
