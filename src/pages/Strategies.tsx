import { useEffect, useState, useRef, Dispatch, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { open } from "@tauri-apps/api/dialog";
import { readTextFile } from "@tauri-apps/api/fs";
import { Plus, Edit2, Trash2, Target, Maximize2, Minimize2, FileText, TrendingUp, ListChecks, GripVertical, X, FolderPlus, ChevronDown, ChevronUp, Folder, ChevronRight, Upload, RotateCcw, ClipboardList, Copy } from "lucide-react";
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

type TabType = "notes" | "trades" | "checklists" | "survey";

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
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  const [strategyToDelete, setStrategyToDelete] = useState<number | null>(null);
  const [showNameRequiredModal, setShowNameRequiredModal] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [tempChecklists, setTempChecklists] = useState<Map<string, ChecklistItem[]>>(new Map());
  const [pendingTradeIds, setPendingTradeIds] = useState<number[]>([]);
  const [isImportingCSV, setIsImportingCSV] = useState(false);
  const [showCSVFormatModal, setShowCSVFormatModal] = useState(false);
  const [pendingCSVFile, setPendingCSVFile] = useState<{ path: string; isForExisting: boolean } | null>(null);
  const [editHistory, setEditHistory] = useState<Array<{ name: string; description: string; color: string; notes: string }>>([]);
  const [editingChecklists, setEditingChecklists] = useState<Map<number, Map<string, ChecklistItem[]>>>(new Map());
  const [originalChecklists, setOriginalChecklists] = useState<Map<number, Map<string, ChecklistItem[]>>>(new Map());
  const [checklistEditHistory, setChecklistEditHistory] = useState<Map<number, Array<Map<string, ChecklistItem[]>>>>(new Map());
  
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
    if ((activeTab === "checklists" || activeTab === "survey") && !checklists.has(strategyId)) {
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
      const defaultTypes = ["entry", "take_profit"];
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
          // Exclude "survey" from being treated as a custom type - it has its own tab
          if (!defaultTypes.includes(type) && type !== "survey") {
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
      setChecklists(new Map(checklists.set(strategyId, checklistMap)));
      setCustomChecklistTypes(new Map(customChecklistTypes.set(strategyId, new Set())));
    }
  };

  const addChecklistItem = async (strategyId: number, type: string, text: string) => {
    if (!text.trim()) return;
    
    // If creating (virtual strategy ID), use tempChecklists
    if (strategyId === -1) {
      const currentChecklist = new Map(tempChecklists);
      const items = currentChecklist.get(type) || [];
      const maxOrder = items.length > 0 ? Math.max(...items.map(i => i.item_order)) : -1;
      
      const newItem: ChecklistItem = {
        id: Date.now(), // Temporary ID
        strategy_id: -1,
        item_text: text.trim(),
        is_checked: false,
        item_order: maxOrder + 1,
        checklist_type: type,
        parent_id: null,
      };

      const updatedChecklist = new Map(currentChecklist);
      updatedChecklist.set(type, [...items, newItem]);
      setTempChecklists(updatedChecklist);
      // Clear the input field for this type
      setNewChecklistItem(prev => {
        const newMap = new Map(prev);
        newMap.set(type, "");
        return newMap;
      });
      return;
    }
    
    // If editing, use editingChecklists instead of saving directly
    if (isEditing && editingChecklists.has(strategyId)) {
      const currentChecklist = editingChecklists.get(strategyId)!;
      const items = currentChecklist.get(type) || [];
      const maxOrder = items.length > 0 ? Math.max(...items.map(i => i.item_order)) : -1;
      
      const newItem: ChecklistItem = {
        id: Date.now(), // Temporary ID (will be replaced when saved)
        strategy_id: strategyId,
        item_text: text.trim(),
        is_checked: false,
        item_order: maxOrder + 1,
        checklist_type: type,
        parent_id: null,
      };

      const updatedChecklist = new Map(currentChecklist);
      updatedChecklist.set(type, [...items, newItem]);
      setEditingChecklists(new Map(editingChecklists.set(strategyId, updatedChecklist)));
      
      // Update history
      const history = checklistEditHistory.get(strategyId) || [];
      const newHistory = [...history, new Map(updatedChecklist)].slice(-10);
      setChecklistEditHistory(new Map(checklistEditHistory.set(strategyId, newHistory)));
      
      // Clear the input field for this type
      setNewChecklistItem(prev => {
        const newMap = new Map(prev);
        newMap.set(type, "");
        return newMap;
      });
      return;
    }
    
    // Otherwise, save directly (for non-editing mode, though this shouldn't happen)
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
    // If creating (virtual strategy ID), use tempChecklists
    if (strategyId === -1) {
      const currentChecklist = tempChecklists;
      const items = currentChecklist.get(type) || [];
      const updatedItems = items.filter(item => item.id !== itemId);
      const updatedChecklist = new Map(currentChecklist);
      updatedChecklist.set(type, updatedItems);
      setTempChecklists(updatedChecklist);
      return;
    }
    
    // If editing, use editingChecklists instead of deleting directly
    if (isEditing && editingChecklists.has(strategyId)) {
      const currentChecklist = editingChecklists.get(strategyId)!;
      const items = currentChecklist.get(type) || [];
      const updatedItems = items.filter(item => item.id !== itemId);
      const updatedChecklist = new Map(currentChecklist);
      updatedChecklist.set(type, updatedItems);
      setEditingChecklists(new Map(editingChecklists.set(strategyId, updatedChecklist)));
      
      // Update history
      const history = checklistEditHistory.get(strategyId) || [];
      const newHistory = [...history, new Map(updatedChecklist)].slice(-10);
      setChecklistEditHistory(new Map(checklistEditHistory.set(strategyId, newHistory)));
      return;
    }
    
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
    const defaultTypes = ["entry", "take_profit"];
    if (defaultTypes.includes(type)) {
      alert("Cannot delete default checklist types (Entry or Take Profit)");
      return;
    }

    if (!confirm(`Are you sure you want to delete the "${type.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')} Checklist"? This will delete all items in this checklist.`)) {
      return;
    }

    // If editing, use editingChecklists instead of deleting directly
    if (isEditing && editingChecklists.has(strategyId)) {
      const currentChecklist = editingChecklists.get(strategyId)!;
      const updatedChecklist = new Map(currentChecklist);
      updatedChecklist.delete(type);
      setEditingChecklists(new Map(editingChecklists.set(strategyId, updatedChecklist)));
      
      // Update history
      const history = checklistEditHistory.get(strategyId) || [];
      const newHistory = [...history, new Map(updatedChecklist)].slice(-10);
      setChecklistEditHistory(new Map(checklistEditHistory.set(strategyId, newHistory)));
      
      // Clear the input field for this type
      setNewChecklistItem(prev => {
        const newMap = new Map(prev);
        newMap.delete(type);
        return newMap;
      });
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
    
    // If creating (virtual strategy ID), use tempChecklists
    if (strategyId === -1) {
      const items = tempChecklists.get(type) || [];
      const selectedItems = items.filter(item => itemIds.includes(item.id));
      const otherItems = items.filter(item => !itemIds.includes(item.id));
      
      // Create group item
      const groupItem: ChecklistItem = {
        id: Date.now(),
        strategy_id: -1,
        item_text: groupName.trim(),
        is_checked: false,
        item_order: items.length > 0 ? Math.max(...items.map(i => i.item_order)) + 1 : 0,
        checklist_type: type,
        parent_id: null,
      };
      
      // Update selected items to have group as parent
      const updatedSelectedItems = selectedItems.map(item => ({
        ...item,
        parent_id: groupItem.id,
      }));
      
      const updatedChecklist = new Map(tempChecklists);
      updatedChecklist.set(type, [...otherItems, groupItem, ...updatedSelectedItems]);
      setTempChecklists(updatedChecklist);
      setSelectedChecklistItems(new Set());
      setShowGroupModal(false);
      setGroupName("");
      setPendingGroupAction(null);
      return;
    }
    
    // If editing, use editingChecklists instead of saving directly
    if (isEditing && editingChecklists.has(strategyId)) {
      const items = editingChecklists.get(strategyId)!.get(type) || [];
      const selectedItems = items.filter(item => itemIds.includes(item.id));
      const otherItems = items.filter(item => !itemIds.includes(item.id));
      
      // Create group item
      const groupItem: ChecklistItem = {
        id: Date.now(),
        strategy_id: strategyId,
        item_text: groupName.trim(),
        is_checked: false,
        item_order: items.length > 0 ? Math.max(...items.map(i => i.item_order)) + 1 : 0,
        checklist_type: type,
        parent_id: null,
      };
      
      // Update selected items to have group as parent
      const updatedSelectedItems = selectedItems.map(item => ({
        ...item,
        parent_id: groupItem.id,
      }));
      
      const updatedChecklist = new Map(editingChecklists.get(strategyId)!);
      updatedChecklist.set(type, [...otherItems, groupItem, ...updatedSelectedItems]);
      setEditingChecklists(new Map(editingChecklists.set(strategyId, updatedChecklist)));
      
      // Update history
      const history = checklistEditHistory.get(strategyId) || [];
      const newHistory = [...history, new Map(updatedChecklist)].slice(-10);
      setChecklistEditHistory(new Map(checklistEditHistory.set(strategyId, newHistory)));
      
      setSelectedChecklistItems(new Set());
      setShowGroupModal(false);
      setGroupName("");
      setPendingGroupAction(null);
      return;
    }
    
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
    
    // If creating, update tempChecklists
    if (isCreating) {
      const updatedChecklist = new Map(tempChecklists);
      for (const [type, items] of updatedChecklist.entries()) {
        const updatedItems = items.map(item => 
          itemIds.includes(item.id) ? { ...item, parent_id: null } : item
        );
        updatedChecklist.set(type, updatedItems);
      }
      setTempChecklists(updatedChecklist);
      setSelectedChecklistItems(new Set());
      return;
    }
    
    // If editing, use editingChecklists instead of saving directly
    if (isEditing && selectedStrategy && editingChecklists.has(selectedStrategy)) {
      const updatedChecklist = new Map(editingChecklists.get(selectedStrategy)!);
      for (const [type, items] of updatedChecklist.entries()) {
        const updatedItems = items.map(item => 
          itemIds.includes(item.id) ? { ...item, parent_id: null } : item
        );
        updatedChecklist.set(type, updatedItems);
      }
      setEditingChecklists(new Map(editingChecklists.set(selectedStrategy, updatedChecklist)));
      
      // Update history
      const history = checklistEditHistory.get(selectedStrategy) || [];
      const newHistory = [...history, new Map(updatedChecklist)].slice(-10);
      setChecklistEditHistory(new Map(checklistEditHistory.set(selectedStrategy, newHistory)));
      
      setSelectedChecklistItems(new Set());
      return;
    }
    
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
    
    // If creating, update tempChecklists
    if (isCreating) {
      const allItems: ChecklistItem[] = [];
      for (const items of tempChecklists.values()) {
        allItems.push(...items);
      }
      const item = allItems.find(i => i.id === itemId);
      if (item) {
        const type = item.checklist_type;
        const items = tempChecklists.get(type) || [];
        const updatedItems = items.map(i => i.id === itemId ? { ...i, item_text: newText.trim() } : i);
        const updatedChecklist = new Map(tempChecklists);
        updatedChecklist.set(type, updatedItems);
        setTempChecklists(updatedChecklist);
      }
      setEditingItemId(null);
      setEditingItemText("");
      return;
    }
    
    // If editing, update editingChecklists instead of saving directly
    if (isEditing && selectedStrategy && editingChecklists.has(selectedStrategy)) {
      const checklistMap = editingChecklists.get(selectedStrategy)!;
      const allItems: ChecklistItem[] = [];
      for (const items of checklistMap.values()) {
        allItems.push(...items);
      }
      const item = allItems.find(i => i.id === itemId);
      if (item) {
        const type = item.checklist_type;
        const items = checklistMap.get(type) || [];
        const updatedItems = items.map(i => i.id === itemId ? { ...i, item_text: newText.trim() } : i);
        const updatedChecklist = new Map(checklistMap);
        updatedChecklist.set(type, updatedItems);
        setEditingChecklists(new Map(editingChecklists.set(selectedStrategy, updatedChecklist)));
        
        // Update history
        const history = checklistEditHistory.get(selectedStrategy) || [];
        const newHistory = [...history, new Map(updatedChecklist)].slice(-10);
        setChecklistEditHistory(new Map(checklistEditHistory.set(selectedStrategy, newHistory)));
      }
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
    // If editing, use editingChecklists instead of saving directly
    if (isEditing && editingChecklists.has(strategyId)) {
      const currentChecklist = editingChecklists.get(strategyId)!;
      const items = currentChecklist.get(type) || [];
      
      const oldIndex = items.findIndex(item => item.id === activeId);
      const newIndex = items.findIndex(item => item.id === overId);
      
      if (oldIndex === -1 || newIndex === -1) return;
      
      const reorderedItems = arrayMove(items, oldIndex, newIndex);
      const updatedItems = reorderedItems.map((item, index) => ({
        ...item,
        item_order: index,
      }));

      const updatedChecklist = new Map(currentChecklist);
      updatedChecklist.set(type, updatedItems);
      setEditingChecklists(new Map(editingChecklists.set(strategyId, updatedChecklist)));
      
      // Update history
      const history = checklistEditHistory.get(strategyId) || [];
      const newHistory = [...history, new Map(updatedChecklist)].slice(-10);
      setChecklistEditHistory(new Map(checklistEditHistory.set(strategyId, newHistory)));
      return;
    }
    
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

  const handleImportCSVForStrategy = async () => {
    try {
      setIsImportingCSV(true);
      const file = await open({
        filters: [{ name: "CSV", extensions: ["csv"] }],
        multiple: false,
      });

      if (!file) {
        setIsImportingCSV(false);
        return;
      }

      // Handle both string (single file) and array (multiple files) cases
      const filePath = Array.isArray(file) ? file[0] : file;
      
      if (filePath && typeof filePath === "string") {
        // Store the file and show format selection modal
        setPendingCSVFile({ path: filePath, isForExisting: false });
        setShowCSVFormatModal(true);
        setIsImportingCSV(false);
      } else {
        alert("Please select a valid CSV file.");
        setIsImportingCSV(false);
      }
    } catch (error) {
      console.error("Error importing CSV:", error);
      alert("Failed to import CSV: " + (error instanceof Error ? error.message : String(error)));
      setIsImportingCSV(false);
    }
  };

  const handleCSVFormatSelection = async (_format: "webull" | "coinbase") => {
    if (!pendingCSVFile) return;
    
    try {
      setIsImportingCSV(true);
      setShowCSVFormatModal(false);
      
      const contents = await readTextFile(pendingCSVFile.path);
      const importedTradeIds = await invoke<number[]>("import_trades_csv", { csvData: contents });
      
      if (pendingCSVFile.isForExisting) {
        // Handle existing strategy import
        if (!selectedStrategy) {
          setIsImportingCSV(false);
          setPendingCSVFile(null);
          return;
        }
        
        if (importedTradeIds && importedTradeIds.length > 0) {
          // Immediately assign all imported trades to the selected strategy
          for (const tradeId of importedTradeIds) {
            await invoke("update_trade_strategy", { tradeId, strategyId: selectedStrategy });
          }
          
          // Reload trades for this strategy
          const pairingMethod = localStorage.getItem("tradebutler_pairing_method") || "FIFO";
          const pairs = await invoke<PairedTrade[]>("get_paired_trades_by_strategy", {
            strategyId: selectedStrategy,
            pairingMethod: pairingMethod,
            startDate: null,
            endDate: null,
          });
          setStrategyPairs(new Map(strategyPairs.set(selectedStrategy, pairs)));
          
          // Update stats
          const stats = calculateStrategyStats(pairs);
          setStrategyStats(new Map(strategyStats.set(selectedStrategy, stats)));
          
          alert(`Trades imported successfully! ${importedTradeIds.length} trade(s) have been assigned to this strategy.`);
        } else {
          alert("No new trades were imported. They may have been duplicates.");
        }
      } else {
        // Handle new strategy import
        if (importedTradeIds && importedTradeIds.length > 0) {
          setPendingTradeIds(prev => [...prev, ...importedTradeIds]);
          alert(`Trades imported successfully! ${importedTradeIds.length} trade(s) will be assigned to this strategy when you save.`);
        } else {
          alert("No new trades were imported. They may have been duplicates.");
        }
      }
      
      setPendingCSVFile(null);
    } catch (error) {
      console.error("Error importing CSV:", error);
      alert("Failed to import CSV: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setIsImportingCSV(false);
    }
  };

  const handleImportCSVForExistingStrategy = async () => {
    if (!selectedStrategy) return;
    
    try {
      setIsImportingCSV(true);
      const file = await open({
        filters: [{ name: "CSV", extensions: ["csv"] }],
        multiple: false,
      });

      if (!file) {
        setIsImportingCSV(false);
        return;
      }

      // Handle both string (single file) and array (multiple files) cases
      const filePath = Array.isArray(file) ? file[0] : file;
      
      if (filePath && typeof filePath === "string") {
        // Store the file and show format selection modal
        setPendingCSVFile({ path: filePath, isForExisting: true });
        setShowCSVFormatModal(true);
        setIsImportingCSV(false);
      } else {
        alert("Please select a valid CSV file.");
        setIsImportingCSV(false);
      }
    } catch (error) {
      console.error("Error importing CSV:", error);
      alert("Failed to import CSV: " + (error instanceof Error ? error.message : String(error)));
      setIsImportingCSV(false);
    }
  };

  const handleSaveNew = async () => {
    if (!editingFormData.name.trim()) {
      setShowNameRequiredModal(true);
      // Focus the input field after a short delay to ensure the modal doesn't block it
      setTimeout(() => {
        nameInputRef.current?.focus();
      }, 100);
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

      // Assign pending trades to the strategy
      const hadPendingTrades = pendingTradeIds.length > 0;
      if (pendingTradeIds.length > 0) {
        for (const tradeId of pendingTradeIds) {
          await invoke("update_trade_strategy", { tradeId, strategyId: newStrategyId });
        }
      }

      // Save temporary checklist items (preserve parent relationships)
      if (tempChecklists.size > 0) {
        const idMap = new Map<number, number>(); // Maps temp ID to new database ID
        
        // First pass: Save all items without parents (groups and regular items)
        for (const [type, items] of tempChecklists.entries()) {
          const itemsWithoutParents = items.filter(item => !item.parent_id);
          for (const item of itemsWithoutParents) {
            const newId = await invoke<number>("save_strategy_checklist_item", {
              id: null,
              strategyId: newStrategyId,
              itemText: item.item_text,
              isChecked: item.is_checked,
              itemOrder: item.item_order,
              checklistType: type,
              parentId: null,
            });
            idMap.set(item.id, newId);
          }
        }
        
        // Second pass: Save items with parents (children of groups)
        for (const [type, items] of tempChecklists.entries()) {
          const itemsWithParents = items.filter(item => item.parent_id);
          for (const item of itemsWithParents) {
            const newParentId = idMap.get(item.parent_id!);
            if (newParentId) {
              await invoke<number>("save_strategy_checklist_item", {
                id: null,
                strategyId: newStrategyId,
                itemText: item.item_text,
                isChecked: item.is_checked,
                itemOrder: item.item_order,
                checklistType: type,
                parentId: newParentId,
              });
            }
          }
        }
      }

      // Reset and reload
      setIsCreating(false);
      setNewStrategyNotes("");
      setEditingFormData({ name: "", description: "", color: "#3b82f6" });
      setPendingTradeIds([]);
      setTempChecklists(new Map());
      await loadStrategies();
      setSelectedStrategy(newStrategyId);
      
      // If there were pending trades, switch to trades tab and reload trades
      if (hadPendingTrades) {
        setActiveTab("trades");
        // Clear the cached pairs so they reload
        const updatedPairs = new Map(strategyPairs);
        updatedPairs.delete(newStrategyId);
        setStrategyPairs(updatedPairs);
        // Load the trades for the new strategy
        await loadStrategyData(newStrategyId);
      }
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
    setPendingTradeIds([]);
    setTempChecklists(new Map());
  };

  const handleEditClick = () => {
    if (selectedStrategyData) {
      setIsEditing(true);
      const initialData = {
        name: selectedStrategyData.name,
        description: selectedStrategyData.description || "",
        color: selectedStrategyData.color || "#3b82f6",
        notes: selectedStrategyData.notes || "",
      };
      setEditingFormData({
        name: initialData.name,
        description: initialData.description,
        color: initialData.color,
      });
      // Store initial state for undo
      setEditHistory([initialData]);
      // Ensure notes are loaded into notesContent for editing
      setNotesContent(new Map(notesContent.set(selectedStrategyData.id, initialData.notes)));
      
      // Initialize checklist editing state - save original and create working copy
      if (selectedStrategyData.id) {
        const currentChecklist = checklists.get(selectedStrategyData.id) || new Map<string, ChecklistItem[]>();
        // Deep copy the original checklist
        const originalCopy = new Map<string, ChecklistItem[]>();
        for (const [type, items] of currentChecklist.entries()) {
          originalCopy.set(type, items.map(item => ({ ...item })));
        }
        setOriginalChecklists(new Map(originalChecklists.set(selectedStrategyData.id, originalCopy)));
        
        // Create working copy for editing
        const editingCopy = new Map<string, ChecklistItem[]>();
        for (const [type, items] of currentChecklist.entries()) {
          editingCopy.set(type, items.map(item => ({ ...item })));
        }
        setEditingChecklists(new Map(editingChecklists.set(selectedStrategyData.id, editingCopy)));
        
        // Initialize history with original state
        setChecklistEditHistory(new Map(checklistEditHistory.set(selectedStrategyData.id, [originalCopy])));
      }
    }
  };

  const handleSaveChecklists = async (strategyId: number) => {
    if (!editingChecklists.has(strategyId)) return;
    
    const editingChecklist = editingChecklists.get(strategyId)!;
    const originalChecklist = originalChecklists.get(strategyId) || new Map<string, ChecklistItem[]>();
    
    // Get all items from both original and editing to compare
    const allOriginalItems = new Map<number, ChecklistItem>();
    for (const items of originalChecklist.values()) {
      for (const item of items) {
        allOriginalItems.set(item.id, item);
      }
    }
    
    const allEditingItems = new Map<number, ChecklistItem>();
    for (const items of editingChecklist.values()) {
      for (const item of items) {
        allEditingItems.set(item.id, item);
      }
    }
    
    // Delete items that were removed
    for (const [itemId] of allOriginalItems.entries()) {
      if (!allEditingItems.has(itemId)) {
        await invoke("delete_strategy_checklist_item", { id: itemId });
      }
    }
    
    // Save or update items that exist in editing
    for (const [type, items] of editingChecklist.entries()) {
      for (const item of items) {
        const originalItem = allOriginalItems.get(item.id);
        const isNew = !originalItem;
        const hasChanged = isNew || (originalItem && (
          originalItem.item_text !== item.item_text ||
          originalItem.item_order !== item.item_order ||
          originalItem.parent_id !== item.parent_id ||
          originalItem.checklist_type !== item.checklist_type
        ));
        
        if (isNew || hasChanged) {
          await invoke<number>("save_strategy_checklist_item", {
            id: isNew ? null : item.id,
            strategyId: strategyId,
            itemText: item.item_text,
            isChecked: item.is_checked,
            itemOrder: item.item_order,
            checklistType: type,
            parentId: item.parent_id,
          });
        }
      }
    }
    
    // Reload checklists to get updated IDs for new items
    await loadChecklists(strategyId);
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
      
      // Save checklist changes if any
      if (selectedStrategyData.id && editingChecklists.has(selectedStrategyData.id)) {
        await handleSaveChecklists(selectedStrategyData.id);
        
        // Update custom checklist types based on what's in editingChecklists
        const editingChecklist = editingChecklists.get(selectedStrategyData.id)!;
        const defaultTypes = ["entry", "take_profit"];
        const customTypesSet = new Set<string>();
        for (const type of editingChecklist.keys()) {
          // Exclude "survey" from being treated as a custom type - it has its own tab
          if (!defaultTypes.includes(type) && type !== "survey") {
            customTypesSet.add(type);
          }
        }
        setCustomChecklistTypes(new Map(customChecklistTypes.set(selectedStrategyData.id, customTypesSet)));
      }
      
      setIsEditing(false);
      setEditHistory([]); // Clear edit history after saving
      // Clear checklist editing state
      if (selectedStrategyData.id) {
        const updatedEditing = new Map(editingChecklists);
        updatedEditing.delete(selectedStrategyData.id);
        setEditingChecklists(updatedEditing);
        
        const updatedOriginal = new Map(originalChecklists);
        updatedOriginal.delete(selectedStrategyData.id);
        setOriginalChecklists(updatedOriginal);
        
        const updatedHistory = new Map(checklistEditHistory);
        updatedHistory.delete(selectedStrategyData.id);
        setChecklistEditHistory(updatedHistory);
      }
      await loadStrategies();
    } catch (error) {
      console.error("Error saving strategy:", error);
      alert("Failed to save strategy: " + error);
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    if (selectedStrategyData) {
      // Revert to original values from database
      setEditingFormData({
        name: selectedStrategyData.name,
        description: selectedStrategyData.description || "",
        color: selectedStrategyData.color || "#3b82f6",
      });
      // Reset notes to original value from database
      setNotesContent(new Map(notesContent.set(selectedStrategyData.id, selectedStrategyData.notes || "")));
      // Clear edit history
      setEditHistory([]);
      
      // Revert checklists to original state
      if (selectedStrategyData.id && originalChecklists.has(selectedStrategyData.id)) {
        const original = originalChecklists.get(selectedStrategyData.id)!;
        // Deep copy back to checklists
        const restored = new Map<string, ChecklistItem[]>();
        for (const [type, items] of original.entries()) {
          restored.set(type, items.map(item => ({ ...item })));
        }
        setChecklists(new Map(checklists.set(selectedStrategyData.id, restored)));
        
        const updatedEditing = new Map(editingChecklists);
        updatedEditing.delete(selectedStrategyData.id);
        setEditingChecklists(updatedEditing);
        
        const updatedOriginal = new Map(originalChecklists);
        updatedOriginal.delete(selectedStrategyData.id);
        setOriginalChecklists(updatedOriginal);
        
        const updatedHistory = new Map(checklistEditHistory);
        updatedHistory.delete(selectedStrategyData.id);
        setChecklistEditHistory(updatedHistory);
      }
      
      // Reload strategies to ensure we have the latest data
      loadStrategies();
    }
  };

  const handleUndo = () => {
    if (editHistory.length <= 1) return; // Can't undo if we're at the initial state
    
    // Remove the last state and restore the previous one
    const newHistory = [...editHistory];
    newHistory.pop(); // Remove current state
    const previousState = newHistory[newHistory.length - 1]; // Get previous state
    
    setEditHistory(newHistory);
    setEditingFormData({
      name: previousState.name,
      description: previousState.description,
      color: previousState.color,
    });
    
    if (selectedStrategy) {
      setNotesContent(new Map(notesContent.set(selectedStrategy, previousState.notes)));
    }
  };

  const handleChecklistUndo = () => {
    if (!selectedStrategy) return;
    const history = checklistEditHistory.get(selectedStrategy);
    if (!history || history.length <= 1) return; // Can't undo if we're at the initial state
    
    // Remove the last state and restore the previous one
    const newHistory = [...history];
    newHistory.pop(); // Remove current state
    const previousState = newHistory[newHistory.length - 1]; // Get previous state
    
    setChecklistEditHistory(new Map(checklistEditHistory.set(selectedStrategy, newHistory)));
    
    // Deep copy the previous state
    const restored = new Map<string, ChecklistItem[]>();
    for (const [type, items] of previousState.entries()) {
      restored.set(type, items.map(item => ({ ...item })));
    }
    setEditingChecklists(new Map(editingChecklists.set(selectedStrategy, restored)));
  };

  const handleDeleteClick = (id: number) => {
    setStrategyToDelete(id);
    setShowDeleteConfirmModal(true);
  };

  const handleDeleteConfirm = async () => {
    if (!strategyToDelete) return;
    
    try {
      await invoke("delete_strategy", { id: strategyToDelete });
      if (selectedStrategy === strategyToDelete) {
        setSelectedStrategy(null);
      }
      loadStrategies();
      setShowDeleteConfirmModal(false);
      setStrategyToDelete(null);
    } catch (error) {
      console.error("Error deleting strategy:", error);
      alert("Failed to delete strategy: " + error);
    }
  };

  const handleDeleteCancel = () => {
    setShowDeleteConfirmModal(false);
    setStrategyToDelete(null);
  };

  const handleDuplicate = async (strategyId: number) => {
    try {
      const strategy = strategies.find(s => s.id === strategyId);
      if (!strategy) return;

      // Create new strategy name with " (Copy)" suffix
      let newName = `${strategy.name} (Copy)`;
      let counter = 1;
      // Ensure unique name
      while (strategies.some(s => s.name === newName)) {
        newName = `${strategy.name} (Copy ${counter})`;
        counter++;
      }

      // Create the new strategy
      const newStrategyId = await invoke<number>("create_strategy", {
        name: newName,
        description: strategy.description || null,
        notes: strategy.notes || null,
        color: strategy.color || null,
      });

      // Load all checklist items from the original strategy
      const allItems = await invoke<ChecklistItem[]>("get_strategy_checklist", {
        strategyId: strategyId,
        checklistType: null,
      });

      // Copy all checklist items (preserve parent relationships)
      if (allItems.length > 0) {
        const idMap = new Map<number, number>(); // Maps original ID to new database ID
        
        // First pass: Save all items without parents (groups and regular items)
        const itemsWithoutParents = allItems.filter(item => !item.parent_id);
        for (const item of itemsWithoutParents) {
          const newId = await invoke<number>("save_strategy_checklist_item", {
            id: null,
            strategyId: newStrategyId,
            itemText: item.item_text,
            isChecked: false, // Reset checked state for duplicate
            itemOrder: item.item_order,
            checklistType: item.checklist_type,
            parentId: null,
          });
          idMap.set(item.id, newId);
        }
        
        // Second pass: Save items with parents (children of groups)
        const itemsWithParents = allItems.filter(item => item.parent_id);
        for (const item of itemsWithParents) {
          const newParentId = idMap.get(item.parent_id!);
          if (newParentId) {
            await invoke<number>("save_strategy_checklist_item", {
              id: null,
              strategyId: newStrategyId,
              itemText: item.item_text,
              isChecked: false, // Reset checked state for duplicate
              itemOrder: item.item_order,
              checklistType: item.checklist_type,
              parentId: newParentId,
            });
          }
        }
      }

      // Reload strategies and select the new one
      await loadStrategies();
      setSelectedStrategy(newStrategyId);
      setActiveTab("notes");
      setIsEditing(false);
      setIsCreating(false);
    } catch (error) {
      console.error("Error duplicating strategy:", error);
      alert("Failed to duplicate strategy: " + error);
    }
  };

  const handleNotesChange = (strategyId: number | null, content: string) => {
    if (isCreating) {
      setNewStrategyNotes(content);
      return;
    }
    if (!isEditing || !strategyId) return;
    // Just update the local state, don't save to database
    setNotesContent(new Map(notesContent.set(strategyId, content)));
    // Add to edit history for undo (debounced to avoid too many history entries)
    if (editHistory.length > 0) {
      const currentState = {
        name: editingFormData.name,
        description: editingFormData.description,
        color: editingFormData.color,
        notes: content,
      };
      // Only add to history if it's different from the last state
      const lastState = editHistory[editHistory.length - 1];
      if (lastState.notes !== content || 
          lastState.name !== editingFormData.name ||
          lastState.description !== editingFormData.description ||
          lastState.color !== editingFormData.color) {
        setEditHistory(prev => {
          const newHistory = [...prev, currentState];
          return newHistory.slice(-10); // Keep last 10 states
        });
      }
    }
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
                    ref={nameInputRef}
                    type="text"
                    value={editingFormData.name}
                    onChange={(e) => {
                      const newName = e.target.value;
                      setEditingFormData({ ...editingFormData, name: newName });
                      // Track history
                      if (selectedStrategy && editHistory.length > 0) {
                        const currentState = {
                          name: newName,
                          description: editingFormData.description,
                          color: editingFormData.color,
                          notes: notesContent.get(selectedStrategy) || "",
                        };
                        setEditHistory(prev => [...prev, currentState].slice(-10));
                      }
                    }}
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
                      onClick={() => selectedStrategyData && handleDuplicate(selectedStrategyData.id)}
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
                      title="Duplicate"
                    >
                      <Copy size={16} />
                    </button>
                    <button
                      onClick={() => selectedStrategyData && handleDeleteClick(selectedStrategyData.id)}
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
                    {isEditing && (() => {
                      const canUndoNotes = editHistory.length > 1;
                      const canUndoChecklists = selectedStrategy && checklistEditHistory.has(selectedStrategy) && checklistEditHistory.get(selectedStrategy)!.length > 1;
                      const canUndo = canUndoNotes || canUndoChecklists;
                      
                      return canUndo ? (
                        <button
                          onClick={() => {
                            // Undo notes if there's history
                            if (canUndoNotes) {
                              handleUndo();
                            }
                            // Undo checklists if there's history
                            if (canUndoChecklists) {
                              handleChecklistUndo();
                            }
                          }}
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
                      ) : null;
                    })()}
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
                      onChange={(e) => {
                        const newDescription = e.target.value;
                        setEditingFormData({ ...editingFormData, description: newDescription });
                        // Track history
                        if (selectedStrategy && editHistory.length > 0) {
                          const currentState = {
                            name: editingFormData.name,
                            description: newDescription,
                            color: editingFormData.color,
                            notes: notesContent.get(selectedStrategy) || "",
                          };
                          setEditHistory(prev => [...prev, currentState].slice(-10));
                        }
                      }}
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
                      onChange={(e) => {
                        const newColor = e.target.value;
                        setEditingFormData({ ...editingFormData, color: newColor });
                        // Track history
                        if (selectedStrategy && editHistory.length > 0) {
                          const currentState = {
                            name: editingFormData.name,
                            description: editingFormData.description,
                            color: newColor,
                            notes: notesContent.get(selectedStrategy) || "",
                          };
                          setEditHistory(prev => [...prev, currentState].slice(-10));
                        }
                      }}
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
                { id: "trades" as TabType, label: "Trades", icon: TrendingUp },
                { id: "checklists" as TabType, label: "Checklists", icon: ListChecks },
                { id: "survey" as TabType, label: "Survey", icon: ClipboardList },
              ].map((tab) => {
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
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
                    <h3 style={{ fontSize: "18px", fontWeight: "600" }}>Trades</h3>
                    {(isCreating || selectedStrategy) && (
                      <button
                        onClick={isCreating ? handleImportCSVForStrategy : handleImportCSVForExistingStrategy}
                        disabled={isImportingCSV}
                        style={{
                          background: "var(--accent)",
                          border: "none",
                          borderRadius: "6px",
                          padding: "8px 12px",
                          color: "white",
                          cursor: isImportingCSV ? "not-allowed" : "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          fontSize: "13px",
                          fontWeight: "500",
                          opacity: isImportingCSV ? 0.6 : 1,
                        }}
                      >
                        <Upload size={16} />
                        {isImportingCSV ? "Importing..." : "Import CSV"}
                      </button>
                    )}
                  </div>
                  {isCreating ? (
                    <div style={{ 
                      padding: "40px", 
                      textAlign: "center",
                      backgroundColor: "var(--bg-secondary)",
                      borderRadius: "8px",
                      border: "1px dashed var(--border-color)"
                    }}>
                      <Upload size={48} style={{ margin: "0 auto 16px", opacity: 0.5, color: "var(--text-secondary)" }} />
                      <p style={{ color: "var(--text-primary)", fontSize: "16px", marginBottom: "8px", fontWeight: "500" }}>
                        Import trades for this strategy
                      </p>
                      <p style={{ color: "var(--text-secondary)", fontSize: "14px", marginBottom: "20px" }}>
                        Click "Import CSV" above to upload trades. They will be automatically assigned to this strategy when you save.
                      </p>
                      {pendingTradeIds.length > 0 && (
                        <p style={{ color: "var(--accent)", fontSize: "14px", fontWeight: "500" }}>
                          {pendingTradeIds.length} trade{pendingTradeIds.length !== 1 ? "s" : ""} ready to be assigned
                        </p>
                      )}
                    </div>
                  ) : selectedStrategy && strategyStats.has(selectedStrategy) && (() => {
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

              {activeTab === "checklists" && (selectedStrategy || isCreating) && (() => {
                // Use editingChecklists when editing, tempChecklists when creating, or regular checklists otherwise
                const currentChecklist = isCreating 
                  ? tempChecklists 
                  : (isEditing && selectedStrategy && editingChecklists.has(selectedStrategy))
                    ? editingChecklists.get(selectedStrategy)!
                    : (checklists.get(selectedStrategy || 0) || new Map<string, ChecklistItem[]>());
                const virtualStrategyId: number = isCreating ? -1 : (selectedStrategy || 0);
                
                const handleDragEnd = (type: string, event: DragEndEvent) => {
                  const { active, over } = event;
                  if (!over || active.id === over.id) return;
                  if (isCreating) {
                    // Handle reordering in tempChecklists
                    const items = currentChecklist.get(type) || [];
                    const oldIndex = items.findIndex(item => item.id === active.id);
                    const newIndex = items.findIndex(item => item.id === over.id);
                    if (oldIndex === -1 || newIndex === -1) return;
                    const reorderedItems = arrayMove(items, oldIndex, newIndex);
                    const updatedItems = reorderedItems.map((item, index) => ({
                      ...item,
                      item_order: index,
                    }));
                    const updatedChecklist = new Map(currentChecklist);
                    updatedChecklist.set(type, updatedItems);
                    setTempChecklists(updatedChecklist);
                  } else if (isEditing && selectedStrategy && editingChecklists.has(selectedStrategy)) {
                    // Handle reordering in editingChecklists
                    const items = currentChecklist.get(type) || [];
                    const oldIndex = items.findIndex(item => item.id === active.id);
                    const newIndex = items.findIndex(item => item.id === over.id);
                    if (oldIndex === -1 || newIndex === -1) return;
                    const reorderedItems = arrayMove(items, oldIndex, newIndex);
                    const updatedItems = reorderedItems.map((item, index) => ({
                      ...item,
                      item_order: index,
                    }));
                    const updatedChecklist = new Map(currentChecklist);
                    updatedChecklist.set(type, updatedItems);
                    setEditingChecklists(new Map(editingChecklists.set(selectedStrategy, updatedChecklist)));
                    
                    // Update history
                    const history = checklistEditHistory.get(selectedStrategy) || [];
                    const newHistory = [...history, new Map(updatedChecklist)].slice(-10);
                    setChecklistEditHistory(new Map(checklistEditHistory.set(selectedStrategy, newHistory)));
                  } else {
                    reorderChecklistItems(virtualStrategyId, type, active.id as number, over.id as number);
                  }
                };

                // Helper function to get display title for checklist type
                const getChecklistTitle = (type: string): string => {
                  const titleMap: Record<string, string> = {
                    "entry": "Entry Checklist",
                    "take_profit": "Take Profit Checklist",
                    "survey": "Survey",
                  };
                  return titleMap[type] || type.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') + " Checklist";
                };

                // Get all checklist types in order: default types first, then custom
                // Exclude "survey" type from Checklists tab - it should only appear in Survey tab
                const defaultTypes = ["entry", "take_profit"];
                const tempCustomTypes = isCreating 
                  ? Array.from(new Set(Array.from(tempChecklists.keys()).filter(t => !defaultTypes.includes(t) && t !== "survey")))
                  : Array.from(customChecklistTypes.get(selectedStrategy || 0) || []).filter(t => t !== "survey");
                const allTypes = [...defaultTypes, ...tempCustomTypes.filter(t => !defaultTypes.includes(t) && t !== "survey")];

                return (
                  <div style={{ padding: "24px", overflowY: "auto" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "32px", paddingBottom: "16px", borderBottom: "1px solid var(--border-color)" }}>
                      <h2 style={{ fontSize: "24px", fontWeight: "700", color: "var(--text-primary)", margin: 0 }}>
                        Checklists
                      </h2>
                      {(isEditing || isCreating) && (
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
                            selectedStrategy={virtualStrategyId}
                            isEditing={isEditing || isCreating}
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
                            onDeleteChecklist={isCustom && !isCreating ? () => deleteChecklistType(virtualStrategyId, type) : undefined}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {activeTab === "survey" && (selectedStrategy || isCreating) && (() => {
                // Use editingChecklists when editing, tempChecklists when creating, or regular checklists otherwise
                const currentChecklist = isCreating 
                  ? tempChecklists 
                  : (isEditing && selectedStrategy && editingChecklists.has(selectedStrategy))
                    ? editingChecklists.get(selectedStrategy)!
                    : (checklists.get(selectedStrategy || 0) || new Map<string, ChecklistItem[]>());
                const virtualStrategyId: number = isCreating ? -1 : (selectedStrategy || 0);
                
                const handleDragEnd = (type: string, event: DragEndEvent) => {
                  const { active, over } = event;
                  if (!over || active.id === over.id) return;
                  if (isCreating) {
                    // Handle reordering in tempChecklists
                    const items = currentChecklist.get(type) || [];
                    const oldIndex = items.findIndex(item => item.id === active.id);
                    const newIndex = items.findIndex(item => item.id === over.id);
                    if (oldIndex === -1 || newIndex === -1) return;
                    const reorderedItems = arrayMove(items, oldIndex, newIndex);
                    const updatedItems = reorderedItems.map((item, index) => ({
                      ...item,
                      item_order: index,
                    }));
                    const updatedChecklist = new Map(currentChecklist);
                    updatedChecklist.set(type, updatedItems);
                    setTempChecklists(updatedChecklist);
                  } else if (isEditing && selectedStrategy && editingChecklists.has(selectedStrategy)) {
                    // Handle reordering in editingChecklists
                    const items = currentChecklist.get(type) || [];
                    const oldIndex = items.findIndex(item => item.id === active.id);
                    const newIndex = items.findIndex(item => item.id === over.id);
                    if (oldIndex === -1 || newIndex === -1) return;
                    const reorderedItems = arrayMove(items, oldIndex, newIndex);
                    const updatedItems = reorderedItems.map((item, index) => ({
                      ...item,
                      item_order: index,
                    }));
                    const updatedChecklist = new Map(currentChecklist);
                    updatedChecklist.set(type, updatedItems);
                    setEditingChecklists(new Map(editingChecklists.set(selectedStrategy, updatedChecklist)));
                    
                    // Update history
                    const history = checklistEditHistory.get(selectedStrategy) || [];
                    const newHistory = [...history, new Map(updatedChecklist)].slice(-10);
                    setChecklistEditHistory(new Map(checklistEditHistory.set(selectedStrategy, newHistory)));
                  } else {
                    reorderChecklistItems(virtualStrategyId, type, active.id as number, over.id as number);
                  }
                };

                // Get survey items (checklist_type = "survey")
                const surveyItems = currentChecklist.get("survey") || [];
                
                // Initialize survey type if it doesn't exist
                if (!currentChecklist.has("survey")) {
                  const updatedChecklist = new Map(currentChecklist);
                  updatedChecklist.set("survey", []);
                  if (isCreating) {
                    setTempChecklists(updatedChecklist);
                  } else if (isEditing && selectedStrategy) {
                    setEditingChecklists(new Map(editingChecklists.set(selectedStrategy, updatedChecklist)));
                  }
                }

                return (
                  <div style={{ padding: "24px", overflowY: "auto" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "32px", paddingBottom: "16px", borderBottom: "1px solid var(--border-color)" }}>
                      <h2 style={{ fontSize: "24px", fontWeight: "700", color: "var(--text-primary)", margin: 0 }}>
                        Post-Trade Survey
                      </h2>
                    </div>
                    <div>
                      <ChecklistSection
                        type="survey"
                        title="Survey"
                        items={surveyItems}
                        selectedStrategy={virtualStrategyId}
                        isEditing={isEditing || isCreating}
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
                        isCustom={false}
                        onDeleteChecklist={undefined}
                      />
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
                  const typeName = newChecklistName.trim().toLowerCase().replace(/\s+/g, '_');
                  
                  if (isCreating) {
                    // Add to tempChecklists when creating
                    const updatedChecklist = new Map(tempChecklists);
                    if (!updatedChecklist.has(typeName)) {
                      updatedChecklist.set(typeName, []);
                    }
                    setTempChecklists(updatedChecklist);
                  } else if (isEditing && selectedStrategy && editingChecklists.has(selectedStrategy)) {
                    // Add to editingChecklists when editing
                    const currentChecklist = editingChecklists.get(selectedStrategy)!;
                    const updatedChecklist = new Map(currentChecklist);
                    if (!updatedChecklist.has(typeName)) {
                      updatedChecklist.set(typeName, []);
                    }
                    setEditingChecklists(new Map(editingChecklists.set(selectedStrategy, updatedChecklist)));
                    
                    // Update history
                    const history = checklistEditHistory.get(selectedStrategy) || [];
                    const newHistory = [...history, new Map(updatedChecklist)].slice(-10);
                    setChecklistEditHistory(new Map(checklistEditHistory.set(selectedStrategy, newHistory)));
                  } else if (selectedStrategy) {
                    const currentChecklist = checklists.get(selectedStrategy) || new Map<string, ChecklistItem[]>();
                    const updatedChecklist = new Map(currentChecklist);
                    if (!updatedChecklist.has(typeName)) {
                      updatedChecklist.set(typeName, []);
                    }
                    setChecklists(new Map(checklists.set(selectedStrategy, updatedChecklist)));
                    
                    // Add to custom types
                    const customTypesSet = new Set(customChecklistTypes.get(selectedStrategy) || []);
                    customTypesSet.add(typeName);
                    setCustomChecklistTypes(new Map(customChecklistTypes.set(selectedStrategy, customTypesSet)));
                  }
                  
                  setNewChecklistName("");
                  setShowNewChecklistModal(false);
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
                  if (newChecklistName.trim()) {
                    const typeName = newChecklistName.trim().toLowerCase().replace(/\s+/g, '_');
                    
                    if (isCreating) {
                      // Add to tempChecklists when creating
                      const updatedChecklist = new Map(tempChecklists);
                      if (!updatedChecklist.has(typeName)) {
                        updatedChecklist.set(typeName, []);
                      }
                      setTempChecklists(updatedChecklist);
                    } else if (isEditing && selectedStrategy && editingChecklists.has(selectedStrategy)) {
                      // Add to editingChecklists when editing
                      const currentChecklist = editingChecklists.get(selectedStrategy)!;
                      const updatedChecklist = new Map(currentChecklist);
                      if (!updatedChecklist.has(typeName)) {
                        updatedChecklist.set(typeName, []);
                      }
                      setEditingChecklists(new Map(editingChecklists.set(selectedStrategy, updatedChecklist)));
                      
                      // Update history
                      const history = checklistEditHistory.get(selectedStrategy) || [];
                      const newHistory = [...history, new Map(updatedChecklist)].slice(-10);
                      setChecklistEditHistory(new Map(checklistEditHistory.set(selectedStrategy, newHistory)));
                    } else if (selectedStrategy) {
                      const currentChecklist = checklists.get(selectedStrategy) || new Map<string, ChecklistItem[]>();
                      const updatedChecklist = new Map(currentChecklist);
                      if (!updatedChecklist.has(typeName)) {
                        updatedChecklist.set(typeName, []);
                      }
                      setChecklists(new Map(checklists.set(selectedStrategy, updatedChecklist)));
                      
                      // Add to custom types
                      const customTypesSet = new Set(customChecklistTypes.get(selectedStrategy) || []);
                      customTypesSet.add(typeName);
                      setCustomChecklistTypes(new Map(customChecklistTypes.set(selectedStrategy, customTypesSet)));
                    }
                    
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

      {/* Delete Confirmation Modal */}
      {showDeleteConfirmModal && strategyToDelete && (() => {
        const strategy = strategies.find(s => s.id === strategyToDelete);
        const strategyName = strategy?.name || "this strategy";
        return (
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
                Delete Strategy
              </h3>
              <p
                style={{
                  fontSize: "14px",
                  color: "var(--text-primary)",
                  marginBottom: "8px",
                  lineHeight: "1.5",
                }}
              >
                Are you sure you want to delete <strong>"{strategyName}"</strong>?
              </p>
              <p
                style={{
                  fontSize: "13px",
                  color: "var(--text-secondary)",
                  marginBottom: "20px",
                  lineHeight: "1.5",
                }}
              >
                This action cannot be undone. All trades using this strategy will be unassigned, and all checklist items and notes will be permanently deleted.
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
        );
      })()}

      {/* Name Required Modal */}
      {showNameRequiredModal && (
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
          onClick={() => setShowNameRequiredModal(false)}
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
              Strategy Name Required
            </h3>
            <p
              style={{
                fontSize: "14px",
                color: "var(--text-primary)",
                marginBottom: "20px",
                lineHeight: "1.5",
              }}
            >
              Please enter a name for your strategy before saving.
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
                  setShowNameRequiredModal(false);
                  setTimeout(() => {
                    nameInputRef.current?.focus();
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

      {/* CSV Format Selection Modal */}
      {showCSVFormatModal && (
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
            setShowCSVFormatModal(false);
            setPendingCSVFile(null);
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
                marginBottom: "12px",
                color: "var(--text-primary)",
              }}
            >
              Select CSV Format
            </h3>
            <p
              style={{
                fontSize: "14px",
                color: "var(--text-secondary)",
                marginBottom: "20px",
                lineHeight: "1.5",
              }}
            >
              Is this CSV file from Webull or Coinbase?
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
                  setShowCSVFormatModal(false);
                  setPendingCSVFile(null);
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
                onClick={() => handleCSVFormatSelection("coinbase")}
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
                Coinbase
              </button>
              <button
                onClick={() => handleCSVFormatSelection("webull")}
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
                Webull
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
