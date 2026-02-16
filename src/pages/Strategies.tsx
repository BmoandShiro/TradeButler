import React, { useEffect, useState, useRef, Dispatch, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { open } from "@tauri-apps/api/dialog";
import { readTextFile } from "@tauri-apps/api/fs";
import { Plus, Edit2, Trash2, Target, Maximize2, Minimize2, FileText, TrendingUp, ListChecks, GripVertical, X, FolderPlus, ChevronDown, ChevronUp, Folder, ChevronRight, Upload, RotateCcw, ClipboardList, Copy, AlertTriangle, CheckCircle } from "lucide-react";
import { format } from "date-fns";
import RichTextEditor from "../components/RichTextEditor";
import { ColorPicker } from "../components/ColorPicker";
import { saveAllScrollPositions, restoreAllScrollPositions } from "../utils/scrollManager";
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
  display_order: number | null;
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

/** Placeholder item text used to persist empty custom checklist types. Filtered out when displaying. */
const EMPTY_CUSTOM_CHECKLIST_PLACEHOLDER = "__empty_custom_checklist_placeholder__";

// Sortable Strategy Component
function SortableStrategy({
  strategy,
  isSelected,
  selectedStrategy,
  strategyStats,
  expandedStats,
  setExpandedStats,
  onSelect,
  saveAllScrollPositions,
  tabScrollPositions,
  leftPanelScrollRef,
  rightPanelScrollRef,
  clearWorkInProgress,
  setSelectedStrategy,
  setActiveTab,
  setIsEditing,
  setIsCreating,
}: {
  strategy: Strategy;
  isSelected: boolean;
  selectedStrategy: number | null;
  strategyStats: Map<number, { totalTrades: number; totalPnL: number; winRate: number }>;
  expandedStats: Set<number>;
  setExpandedStats: React.Dispatch<React.SetStateAction<Set<number>>>;
  onSelect: () => void;
  saveAllScrollPositions: (tabPositions: React.MutableRefObject<Map<TabType, number>>, leftScroll: number | null, rightScroll: number | null, page: string) => void;
  tabScrollPositions: React.MutableRefObject<Map<TabType, number>>;
  leftPanelScrollRef: React.RefObject<HTMLDivElement>;
  rightPanelScrollRef: React.RefObject<HTMLDivElement>;
  clearWorkInProgress: () => void;
  setSelectedStrategy: React.Dispatch<React.SetStateAction<number | null>>;
  setActiveTab: React.Dispatch<React.SetStateAction<TabType>>;
  setIsEditing: React.Dispatch<React.SetStateAction<boolean>>;
  setIsCreating: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: strategy.id! });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleClick = (e: React.MouseEvent) => {
    // Prevent drag system from interfering with click
    e.stopPropagation();
    
    // Don't trigger if currently dragging
    if (isDragging) {
      return;
    }
    
    console.log('Strategy clicked:', strategy.id, strategy.name);
    console.log('Setting selectedStrategy to:', strategy.id);
    
    // Save scroll position before switching
    saveAllScrollPositions(
      tabScrollPositions.current,
      leftPanelScrollRef.current?.scrollTop ?? null,
      rightPanelScrollRef.current?.scrollTop ?? null,
      "strategies"
    );
    clearWorkInProgress(); // Clear work in progress when selecting an existing strategy
    
    // Set selection - use a function to ensure state update
    setSelectedStrategy(() => {
      console.log('setSelectedStrategy called with:', strategy.id);
      return strategy.id!;
    });
    setActiveTab("notes");
    // Only reset editing/creating when switching to a different strategy
    if (selectedStrategy !== strategy.id) {
      setIsEditing(false);
      setIsCreating(false);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    // Don't prevent if clicking on drag handle - let it work normally
    if ((e.target as HTMLElement).closest('[data-drag-handle]')) {
      return;
    }
    // Stop drag sensor from capturing this event, but allow click to fire
    e.stopPropagation();
  };

  return (
    <div
      ref={setNodeRef}
      data-strategy-id={strategy.id}
      style={{
        ...style,
        padding: "12px",
        backgroundColor: isSelected ? "var(--accent)" : "var(--bg-tertiary)",
        border: `1px solid ${isSelected ? "var(--accent)" : "var(--border-color)"}`,
        borderRadius: "6px",
        transition: "all 0.2s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
        {/* Left side - Drag handle area */}
        <div
          {...attributes}
          {...listeners}
          data-drag-handle
          style={{
            cursor: "grab",
            color: isSelected ? "rgba(255,255,255,0.7)" : "var(--text-secondary)",
            display: "flex",
            alignItems: "center",
            padding: "4px 8px",
            marginLeft: "-4px",
            marginRight: "4px",
          }}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
          title="Drag to reorder"
        >
          <GripVertical size={16} />
        </div>
        {/* Right side - Clickable content area */}
        <div
          onClick={handleClick}
          onMouseDown={handleMouseDown}
          style={{ 
            display: "flex", 
            alignItems: "center", 
            gap: "8px", 
            flex: 1,
            cursor: "pointer",
            padding: "4px 0",
            pointerEvents: "auto",
          }}
        >
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
              flex: 1,
              userSelect: "none", // Prevent text selection on click
            }}
          >
            {strategy.name}
          </h3>
        </div>
      </div>
      {strategy.description && (
        <p
          onClick={handleClick}
          onMouseDown={handleMouseDown}
          style={{
            color: isSelected ? "rgba(255,255,255,0.8)" : "var(--text-secondary)",
            fontSize: "12px",
            marginTop: "4px",
            marginLeft: "28px",
            cursor: "pointer",
            userSelect: "none", // Prevent text selection on click
            pointerEvents: "auto",
          }}
        >
          {strategy.description}
        </p>
      )}
      {strategy.id && strategyStats.has(strategy.id) && (() => {
        const stats = strategyStats.get(strategy.id)!;
        const hasTrades = stats.totalTrades > 0;
        const isCollapsed = expandedStats.has(strategy.id);
        
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

function SortableStrategyItem({
  strategy,
  isSelected,
  selectedStrategy,
  strategyStats,
  expandedStats,
  setExpandedStats,
  setSelectedStrategy,
  setActiveTab,
  setIsEditing,
  setIsCreating,
  saveAllScrollPositions,
  tabScrollPositions,
  leftPanelScrollRef,
  rightPanelScrollRef,
  clearWorkInProgress,
}: {
  strategy: Strategy;
  isSelected: boolean;
  selectedStrategy: number | null;
  strategyStats: Map<number, { totalTrades: number; totalPnL: number; winRate: number }>;
  expandedStats: Set<number>;
  setExpandedStats: Dispatch<SetStateAction<Set<number>>>;
  setSelectedStrategy: Dispatch<SetStateAction<number | null>>;
  setActiveTab: Dispatch<SetStateAction<TabType>>;
  setIsEditing: Dispatch<SetStateAction<boolean>>;
  setIsCreating: Dispatch<SetStateAction<boolean>>;
  saveAllScrollPositions: (tabPositions: Map<TabType, number>, leftPanelScroll: number | null, rightPanelScroll: number | null, storageKey: string) => void;
  tabScrollPositions: React.MutableRefObject<Map<TabType, number>>;
  leftPanelScrollRef: React.RefObject<HTMLDivElement>;
  rightPanelScrollRef: React.RefObject<HTMLDivElement>;
  clearWorkInProgress: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: strategy.id });

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
        padding: "12px",
        backgroundColor: isSelected ? "var(--accent)" : "var(--bg-tertiary)",
        border: `1px solid ${isSelected ? "var(--accent)" : "var(--border-color)"}`,
        borderRadius: "6px",
        cursor: "pointer",
        transition: "all 0.2s",
      }}
      data-strategy-id={strategy.id}
      onClick={() => {
        // Save scroll position before switching
        saveAllScrollPositions(
          tabScrollPositions.current,
          leftPanelScrollRef.current?.scrollTop ?? null,
          rightPanelScrollRef.current?.scrollTop ?? null,
          "strategies"
        );
        clearWorkInProgress(); // Clear work in progress when selecting an existing strategy
        setSelectedStrategy(strategy.id);
        setActiveTab("notes");
        // Only reset editing/creating when switching to a different strategy
        if (selectedStrategy !== strategy.id) {
          setIsEditing(false);
          setIsCreating(false);
        }
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
        <div
          {...attributes}
          {...listeners}
          style={{
            cursor: "grab",
            color: isSelected ? "rgba(255,255,255,0.7)" : "var(--text-secondary)",
            display: "flex",
            alignItems: "center",
            padding: "4px",
          }}
          onClick={(e) => e.stopPropagation()}
          title="Drag to reorder"
        >
          <GripVertical size={16} />
        </div>
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
            flex: 1,
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
            marginLeft: "28px",
          }}
        >
          {strategy.description}
        </p>
      )}
      {strategy.id && strategyStats.has(strategy.id) && (() => {
        const stats = strategyStats.get(strategy.id)!;
        const hasTrades = stats.totalTrades > 0;
        const isCollapsed = expandedStats.has(strategy.id);
        
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
                marginLeft: "28px",
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
  moveItemsToGroup,
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
  addChecklistItem: (strategyId: number, type: string, text: string, parentId?: number | null) => Promise<void>;
  setPendingGroupAction: Dispatch<SetStateAction<{ strategyId: number; type: string; itemIds: number[] } | null>>;
  setGroupName: Dispatch<SetStateAction<string>>;
  setShowGroupModal: Dispatch<SetStateAction<boolean>>;
  ungroupChecklistItems: (itemIds: number[]) => Promise<void>;
  isCustom: boolean;
  onDeleteChecklist?: () => void;
  moveItemsToGroup: (itemIds: number[], groupId: number, checklistType: string) => Promise<void>;
}) {
  // Sort items by item_order first
  const sortedItems = [...items].sort((a, b) => a.item_order - b.item_order);
  
  // Organize items: groups (items with no parent_id that have children) and regular items
  const itemIdsSet = new Set(sortedItems.map(item => item.id));
  const groups = sortedItems.filter(item => !item.parent_id && sortedItems.some(child => child.parent_id === item.id));
  const regularItems = sortedItems.filter(item => !item.parent_id && !sortedItems.some(child => child.parent_id === item.id));
  const groupedItems = sortedItems.filter(item => item.parent_id !== null && itemIdsSet.has(item.parent_id));
  
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
  
  // Sort children within each group by item_order
  for (const [, children] of itemsByParent.entries()) {
    children.sort((a, b) => a.item_order - b.item_order);
  }
  
  // Create a combined sorted list: merge groups and regular items, sorted by item_order
  const allTopLevelItems = [...groups, ...regularItems].sort((a, b) => a.item_order - b.item_order);
  
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
  
  const handleMoveToGroup = (groupId: number) => {
    moveItemsToGroup(selectedItems, groupId, type);
  };
  
  const availableGroups = groups;
  
  return (
    <div style={{ marginBottom: "40px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px", paddingBottom: "12px", borderBottom: "2px solid var(--border-color)" }}>
        <h4 style={{ fontSize: "18px", fontWeight: "700", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px" }}>
          <ListChecks size={18} style={{ color: "var(--accent)" }} />
          {title}
        </h4>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
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
            {/* Render all top-level items (groups and regular items) sorted by item_order */}
            {allTopLevelItems.map((item) => {
              const isGroup = groups.some(g => g.id === item.id);
              const children = isGroup ? (itemsByParent.get(item.id) || []) : [];
              
              if (isGroup) {
                return (
                  <div key={item.id} style={{ marginBottom: "20px", position: "relative" }}>
                    {/* Group Header - Enhanced styling */}
                    <SortableChecklistItem
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
              } else {
                // Regular item
                return (
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
                );
              }
            })}
          </SortableContext>
        </DndContext>
      ) : (
        <div>
          {/* Render all top-level items (groups and regular items) sorted by item_order in view mode */}
          {allTopLevelItems.map((item) => {
            const isGroup = groups.some(g => g.id === item.id);
            const children = isGroup ? (itemsByParent.get(item.id) || []) : [];
            
            if (isGroup) {
              return (
                <div key={item.id} style={{ marginBottom: "20px", position: "relative" }}>
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
                      {item.item_text}
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
            } else {
              // Regular item
              return (
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
              );
            }
          })}
        </div>
      )}
      {isEditing && (
        <>
          {/* Group/Ungroup/Move buttons - separate section above add input */}
          {hasSelection && (
            <div style={{ 
              marginTop: "16px",
              marginBottom: "12px",
              padding: "12px", 
              backgroundColor: "var(--bg-secondary)",
              borderRadius: "6px",
              border: "1px solid var(--border-color)",
            }}>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button
                  onClick={handleGroupSelected}
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
                    fontSize: "12px",
                    fontWeight: "500",
                  }}
                  title="Create New Group with Selected Items"
                >
                  <FolderPlus size={14} />
                  New Group ({selectedItems.length})
                </button>
                {availableGroups.length > 0 && (
                  <select
                    onChange={(e) => {
                      const groupId = e.target.value ? parseInt(e.target.value) : null;
                      if (groupId) {
                        handleMoveToGroup(groupId);
                      }
                      // Reset dropdown
                      e.target.value = "";
                    }}
                    defaultValue=""
                    style={{
                      padding: "8px 12px",
                      backgroundColor: "var(--bg-tertiary)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "6px",
                      color: "var(--text-primary)",
                      fontSize: "12px",
                      cursor: "pointer",
                      outline: "none",
                    }}
                    title="Move Selected to Existing Group"
                  >
                    <option value="" disabled>Move to Group...</option>
                    {availableGroups.map((group) => (
                      <option key={group.id} value={group.id}>
                        Move to: {group.item_text}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  onClick={handleUngroupSelected}
                  style={{
                    background: "var(--bg-tertiary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "6px",
                    padding: "8px 12px",
                    color: "var(--text-primary)",
                    cursor: "pointer",
                    fontSize: "12px",
                    fontWeight: "500",
                  }}
                  title="Ungroup Selected"
                >
                  Ungroup
                </button>
              </div>
            </div>
          )}
          
          {/* Add item input */}
          <div style={{ 
            marginTop: hasSelection ? "0" : "16px",
            padding: "16px",
            backgroundColor: "var(--bg-secondary)",
            borderRadius: "8px",
            border: "1px dashed var(--border-color)",
          }}>
            <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
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
                  addChecklistItem(selectedStrategy, type, currentValue, null);
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
              onClick={() => addChecklistItem(selectedStrategy, type, currentValue, null)}
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
          </div>
        </>
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
  const [selectedStrategy, setSelectedStrategy] = useState<number | null>(() => {
    const saved = localStorage.getItem('strategies_selected_strategy');
    return saved ? parseInt(saved, 10) : null;
  });
  const [activeTab, setActiveTab] = useState<TabType>(() => {
    const saved = localStorage.getItem('strategies_active_tab');
    return (saved as TabType) || "notes";
  });
  const [isMaximized, setIsMaximized] = useState(false);
  
  // Refs for scroll containers
  const leftPanelScrollRef = useRef<HTMLDivElement>(null);
  const rightPanelScrollRef = useRef<HTMLDivElement>(null);
  const tabScrollPositions = useRef<Map<TabType, number>>(new Map());
  const tabContentRefs = useRef<Map<TabType, HTMLDivElement | null>>(new Map());
  const [strategyPairs, setStrategyPairs] = useState<Map<number, PairedTrade[]>>(new Map());
  const [loadingPairs, setLoadingPairs] = useState<Set<number>>(new Set());
  const [strategyStats, setStrategyStats] = useState<Map<number, { totalTrades: number; totalPnL: number; winRate: number }>>(new Map());
  
  // Sensors for strategy drag-and-drop
  const strategySensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: (event) => {
        const target = event.target as HTMLElement | null;
        // Only activate drag if clicking on the drag handle
        if (target?.closest('[data-drag-handle]')) {
          return { distance: 8 }; // Require 8px movement before drag starts
        }
        // Never activate if not clicking on drag handle - allow clicks to work
        return { distance: Infinity };
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );
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
  const [associatedRecords, setAssociatedRecords] = useState<{
    trade_count: number;
    journal_entry_count: number;
    checklist_item_count: number;
    sample_trades: Array<[number, string, string, string]>;
    sample_journal_entries: Array<[number, string, string]>;
  } | null>(null);
  const [loadingAssociatedRecords, setLoadingAssociatedRecords] = useState(false);
  const [showNameRequiredModal, setShowNameRequiredModal] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  // Track if we're in the middle of a save/cancel operation to prevent unwanted restorations
  const isSavingOrCancelingRef = useRef(false);
  const [tempChecklists, setTempChecklists] = useState<Map<string, ChecklistItem[]>>(new Map());
  const [pendingTradeIds, setPendingTradeIds] = useState<number[]>([]);
  const [isImportingCSV, setIsImportingCSV] = useState(false);
  const [showCSVFormatModal, setShowCSVFormatModal] = useState(false);
  const [pendingCSVFile, setPendingCSVFile] = useState<{ path: string; isForExisting: boolean } | null>(null);
  const [pendingCSVFiles, setPendingCSVFiles] = useState<{ path: string; isForExisting: boolean }[]>([]);
  const [importResults, setImportResults] = useState<{
    totalAttempted: number;
    newTrades: number;
    duplicates: number;
    errors: number;
  } | null>(null);
  const [showAddTradeModal, setShowAddTradeModal] = useState(false);
  const [addTradeForm, setAddTradeForm] = useState({
    symbol: "",
    side: "BUY",
    quantity: "",
    price: "",
    tradeDate: format(new Date(), "yyyy-MM-dd"),
    tradeTime: format(new Date(), "HH:mm"),
    orderType: "MARKET",
    fees: "",
    notes: "",
  });
  const [isAddingTrade, setIsAddingTrade] = useState(false);
  const [addTradeError, setAddTradeError] = useState<string | null>(null);
  /** Strategy to assign the new trade to: captured when user opens Add Trade from Strategies tab (so it auto-assigns to the currently selected strategy). */
  const addTradeStrategyIdRef = useRef<number | null>(null);
  const [editHistory, setEditHistory] = useState<Array<{ name: string; description: string; color: string; notes: string }>>([]);
  const [editingChecklists, setEditingChecklists] = useState<Map<number, Map<string, ChecklistItem[]>>>(new Map());
  const [originalChecklists, setOriginalChecklists] = useState<Map<number, Map<string, ChecklistItem[]>>>(new Map());
  const [checklistEditHistory, setChecklistEditHistory] = useState<Map<number, Array<Map<string, ChecklistItem[]>>>>(new Map());
  
  // Strategy order state (similar to metric card order)
  const STRATEGY_ORDER_KEY = "tradebutler_strategy_order";
  const [strategyOrder, setStrategyOrder] = useState<number[]>(() => {
    const saved = localStorage.getItem(STRATEGY_ORDER_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return [];
      }
    }
    return [];
  });
  
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px of movement before drag starts
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Save work-in-progress to localStorage
  const saveWorkInProgress = () => {
    if (isCreating || isEditing) {
      const workInProgress = {
        editingFormData,
        newStrategyNotes,
        notesContent: Array.from(notesContent.entries()),
        tempChecklists: isCreating ? Array.from(tempChecklists.entries()).map(([type, items]) => [
          type,
          items.map(item => ({ ...item }))
        ]) : [],
        editingChecklists: isEditing && selectedStrategy ? Array.from(editingChecklists.entries()).map(([strategyId, checklists]) => [
          strategyId,
          Array.from(checklists.entries()).map(([type, items]) => [
            type,
            items.map(item => ({ ...item }))
          ])
        ]) : [],
        selectedStrategy,
        activeTab,
        isCreating,
        isEditing,
        scrollPositions: Array.from(tabScrollPositions.current.entries()),
        leftPanelScroll: leftPanelScrollRef.current?.scrollTop || 0,
      };
      localStorage.setItem('strategies_work_in_progress', JSON.stringify(workInProgress));
    }
  };

  // Restore work-in-progress from localStorage
  const restoreWorkInProgress = () => {
    try {
      const saved = localStorage.getItem('strategies_work_in_progress');
      if (saved) {
        const workInProgress = JSON.parse(saved);
        setEditingFormData(workInProgress.editingFormData);
        setNewStrategyNotes(workInProgress.newStrategyNotes || "");
        
        // Restore notes content
        const restoredNotes = new Map<number, string>();
        workInProgress.notesContent.forEach(([strategyId, notes]: [number, string]) => {
          restoredNotes.set(strategyId, notes);
        });
        setNotesContent(restoredNotes);
        
        // Restore temp checklists if creating
        if (workInProgress.isCreating && workInProgress.tempChecklists) {
          const restored = new Map<string, ChecklistItem[]>();
          workInProgress.tempChecklists.forEach(([type, items]: [string, any[]]) => {
            restored.set(type, items);
          });
          setTempChecklists(restored);
        }
        
        // Restore editing checklists if editing
        if (workInProgress.isEditing && workInProgress.editingChecklists) {
          const restored = new Map<number, Map<string, ChecklistItem[]>>();
          workInProgress.editingChecklists.forEach(([strategyId, checklists]: [number, any[]]) => {
            const checklistMap = new Map<string, ChecklistItem[]>();
            checklists.forEach(([type, items]: [string, any[]]) => {
              checklistMap.set(type, items);
            });
            restored.set(strategyId, checklistMap);
          });
          setEditingChecklists(restored);
        }
        
        setSelectedStrategy(workInProgress.selectedStrategy);
        setActiveTab(workInProgress.activeTab);
        setIsCreating(workInProgress.isCreating);
        setIsEditing(workInProgress.isEditing);
        
        // Restore scroll positions
        workInProgress.scrollPositions.forEach(([tab, pos]: [TabType, number]) => {
          tabScrollPositions.current.set(tab, pos);
        });
        
        // Restore left panel scroll
        if (workInProgress.leftPanelScroll && leftPanelScrollRef.current) {
          requestAnimationFrame(() => {
            if (leftPanelScrollRef.current) {
              leftPanelScrollRef.current.scrollTop = workInProgress.leftPanelScroll;
            }
          });
        }
        
        // Load strategy data if editing an existing strategy
        if (workInProgress.selectedStrategy && !workInProgress.isCreating) {
          loadStrategyData(workInProgress.selectedStrategy);
        }
      }
    } catch (error) {
      console.error("Error restoring work in progress:", error);
    }
  };

  // Clear work-in-progress from localStorage
  const clearWorkInProgress = () => {
    localStorage.removeItem('strategies_work_in_progress');
  };

  // Save scroll positions using utility
  const saveScrollPositions = () => {
    saveAllScrollPositions(
      tabScrollPositions.current,
      leftPanelScrollRef.current?.scrollTop ?? null,
      rightPanelScrollRef.current?.scrollTop ?? null,
      "strategies"
    );
  };

  // Restore scroll positions using utility
  const restoreScrollPositions = () => {
    const scrollState = restoreAllScrollPositions("strategies");
    
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
    
    // Restore right panel scroll
    if (rightPanelScrollRef.current && scrollState.rightPanelScroll !== null) {
      requestAnimationFrame(() => {
        if (rightPanelScrollRef.current) {
          rightPanelScrollRef.current.scrollTop = scrollState.rightPanelScroll!;
        }
      });
    }
  };

  // Save selected strategy and active tab to localStorage
  useEffect(() => {
    if (selectedStrategy !== null) {
      localStorage.setItem('strategies_selected_strategy', selectedStrategy.toString());
    } else {
      localStorage.removeItem('strategies_selected_strategy');
    }
  }, [selectedStrategy]);

  useEffect(() => {
    localStorage.setItem('strategies_active_tab', activeTab);
  }, [activeTab]);

  // Restore state from localStorage
  const restoreState = () => {
    const savedStrategy = localStorage.getItem('strategies_selected_strategy');
    if (savedStrategy) {
      const strategyId = parseInt(savedStrategy, 10);
      // Verify strategy still exists before restoring
      const strategyExists = strategies.some(s => s.id === strategyId);
      if (strategyExists) {
        setSelectedStrategy(strategyId);
      }
    }
    
    const savedTab = localStorage.getItem('strategies_active_tab');
    if (savedTab) {
      setActiveTab(savedTab as TabType);
    }
    
    // Restore scroll positions after a delay to ensure DOM is ready
    setTimeout(() => {
      restoreScrollPositions();
    }, 100);
  };

  // Save work-in-progress before component unmounts
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
  }, [editingFormData, newStrategyNotes, notesContent, tempChecklists, editingChecklists, selectedStrategy, activeTab, isCreating, isEditing]);

  // Save scroll positions on scroll
  useEffect(() => {
    const leftPanel = leftPanelScrollRef.current;
    const rightPanel = rightPanelScrollRef.current;
    
    const handleScroll = () => {
      // Save all scroll positions when either panel scrolls
      saveAllScrollPositions(
        tabScrollPositions.current,
        leftPanelScrollRef.current?.scrollTop ?? null,
        rightPanelScrollRef.current?.scrollTop ?? null,
        "strategies"
      );
    };
    
    if (leftPanel) {
      leftPanel.addEventListener('scroll', handleScroll, { passive: true });
    }
    
    if (rightPanel) {
      rightPanel.addEventListener('scroll', handleScroll, { passive: true });
    }
    
    return () => {
      if (leftPanel) {
        leftPanel.removeEventListener('scroll', handleScroll);
      }
      if (rightPanel) {
        rightPanel.removeEventListener('scroll', handleScroll);
      }
    };
  }, []);

  useEffect(() => {
    loadStrategies();
  }, []);

  // Restore state after strategies are loaded (but not during save/cancel operations)
  useEffect(() => {
    if (strategies.length > 0 && !isSavingOrCancelingRef.current) {
      restoreState();
      
      // Restore work in progress after loading, but only if we're not in the middle of a save operation
      // Check if work-in-progress indicates we're creating/editing, otherwise skip restoration
      const hasWorkInProgress = localStorage.getItem('strategies_work_in_progress');
      if (hasWorkInProgress) {
        try {
          const workInProgress = JSON.parse(hasWorkInProgress);
          // Only restore if we're actually in a creating or editing state
          // This prevents restoring after a save when isCreating/isEditing are false
          if (workInProgress.isCreating || workInProgress.isEditing) {
            setTimeout(() => {
              // Double-check the state hasn't changed (e.g., by a save operation)
              const stillHasWorkInProgress = localStorage.getItem('strategies_work_in_progress');
              if (stillHasWorkInProgress) {
                const currentState = JSON.parse(stillHasWorkInProgress);
                // Only restore if still in creating/editing state
                if (currentState.isCreating || currentState.isEditing) {
                  restoreWorkInProgress();
                }
              }
            }, 200);
          }
        } catch (error) {
          console.error("Error checking work in progress:", error);
        }
      }
    }
    // Reset the flag after a brief delay
    if (isSavingOrCancelingRef.current) {
      setTimeout(() => {
        isSavingOrCancelingRef.current = false;
      }, 500);
    }
  }, [strategies]);

  // Restore scroll position when tab changes
  useEffect(() => {
    // For tabs with their own scroll containers (trades, checklists, survey)
    const tabContent = tabContentRefs.current.get(activeTab);
    if (tabContent) {
      const savedPosition = tabScrollPositions.current.get(activeTab) || 0;
      requestAnimationFrame(() => {
        if (tabContent) {
          tabContent.scrollTop = savedPosition;
        }
      });
    } else if (rightPanelScrollRef.current) {
      // For tabs without their own scroll container (notes), use the right panel scroll
      const savedPosition = tabScrollPositions.current.get(activeTab) || 0;
      requestAnimationFrame(() => {
        if (rightPanelScrollRef.current) {
          rightPanelScrollRef.current.scrollTop = savedPosition;
        }
      });
    }
  }, [activeTab]);

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

  // Sort strategies based on order
  const sortedStrategies = React.useMemo(() => {
    if (strategyOrder.length === 0) {
      return strategies;
    }
    
    const ordered = [...strategies].sort((a, b) => {
      const aIndex = strategyOrder.indexOf(a.id!);
      const bIndex = strategyOrder.indexOf(b.id!);
      
      // If both are in order, sort by order
      if (aIndex !== -1 && bIndex !== -1) {
        return aIndex - bIndex;
      }
      // If only one is in order, prioritize it
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      // If neither is in order, maintain original order
      return 0;
    });
    
    return ordered;
  }, [strategies, strategyOrder]);

  const loadStrategies = async (preserveEditingState = false) => {
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
      // Only update notesContent if we're not preserving editing state
      if (!preserveEditingState) {
        setNotesContent(notesMap);
      }
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
    // Save selected strategy ID to localStorage
    localStorage.setItem('strategies_selected_strategy', strategyId.toString());
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
    // Load checklists - always load when strategy is selected (not creating) to ensure custom checklists are available
    if (!isCreating && !checklists.has(strategyId)) {
      await loadChecklists(strategyId);
    }
    
    // Restore scroll positions after strategy data is loaded
    setTimeout(() => {
      const scrollState = restoreAllScrollPositions("strategies");
      // Restore left panel scroll
      if (leftPanelScrollRef.current && scrollState.leftPanelScroll !== null) {
        requestAnimationFrame(() => {
          if (leftPanelScrollRef.current) {
            leftPanelScrollRef.current.scrollTop = scrollState.leftPanelScroll!;
          }
        });
      }
      // Restore right panel scroll
      if (rightPanelScrollRef.current && scrollState.rightPanelScroll !== null) {
        requestAnimationFrame(() => {
          if (rightPanelScrollRef.current) {
            rightPanelScrollRef.current.scrollTop = scrollState.rightPanelScroll!;
          }
        });
      }
      // Restore active tab scroll
      const tabContent = tabContentRefs.current.get(activeTab);
      if (tabContent) {
        const savedPosition = tabScrollPositions.current.get(activeTab) || scrollState.tabPositions.get(activeTab) || 0;
        if (savedPosition > 0) {
          requestAnimationFrame(() => {
            tabContent.scrollTop = savedPosition;
          });
        }
      } else if (rightPanelScrollRef.current && activeTab === "notes") {
        // Notes tab uses right panel scroll
        const savedPosition = tabScrollPositions.current.get(activeTab) || scrollState.tabPositions.get(activeTab) || 0;
        if (savedPosition > 0) {
          requestAnimationFrame(() => {
            if (rightPanelScrollRef.current) {
              rightPanelScrollRef.current.scrollTop = savedPosition;
            }
          });
        }
      }
    }, 200);
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
      
      // Placeholder items used to persist empty custom checklist types - filter them out when displaying
      
      // Initialize default types
      for (const type of defaultTypes) {
        checklistMap.set(type, []);
      }
      
      // Group items by type (exclude placeholder items from display, but ensure their type is registered)
      for (const item of allItems) {
        const type = item.checklist_type;
        if (!checklistMap.has(type)) {
          checklistMap.set(type, []);
          if (!defaultTypes.includes(type) && type !== "survey") {
            customTypesSet.add(type);
          }
        }
        if (item.item_text === EMPTY_CUSTOM_CHECKLIST_PLACEHOLDER) continue;
        checklistMap.get(type)!.push(item);
      }
      
      setChecklists((prev) => {
        const next = new Map(prev);
        next.set(strategyId, checklistMap);
        return next;
      });
      setCustomChecklistTypes((prev) => {
        const next = new Map(prev);
        next.set(strategyId, customTypesSet);
        return next;
      });
    } catch (error) {
      console.error("Error loading checklists:", error);
      // Fallback to default structure
      const checklistMap = new Map<string, ChecklistItem[]>();
      checklistMap.set("entry", []);
      checklistMap.set("take_profit", []);
      setChecklists((prev) => {
        const next = new Map(prev);
        next.set(strategyId, checklistMap);
        return next;
      });
      setCustomChecklistTypes((prev) => {
        const next = new Map(prev);
        next.set(strategyId, new Set());
        return next;
      });
    }
  };

  const addChecklistItem = async (strategyId: number, type: string, text: string, parentId: number | null = null) => {
    if (!text.trim()) return;
    
    // If creating (virtual strategy ID), use tempChecklists
    if (strategyId === -1) {
      const currentChecklist = new Map(tempChecklists);
      const items = currentChecklist.get(type) || [];
      const maxOrder = items.length > 0 ? Math.max(...items.map(i => i.item_order)) : -1;
      
      // Calculate order: if adding to a group, order within that group; otherwise top-level order
      let itemOrder = maxOrder + 1;
      if (parentId) {
        const groupChildren = items.filter(i => i.parent_id === parentId);
        if (groupChildren.length > 0) {
          itemOrder = Math.max(...groupChildren.map(i => i.item_order)) + 1;
      } else {
          itemOrder = maxOrder + 1;
        }
      }
      
      const newItem: ChecklistItem = {
        id: Date.now(), // Temporary ID
        strategy_id: -1,
        item_text: text.trim(),
        is_checked: false,
        item_order: itemOrder,
        checklist_type: type,
        parent_id: parentId,
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
    if (isEditing) {
      // Initialize editingChecklists if it doesn't have this strategy yet
      let currentChecklist: Map<string, ChecklistItem[]>;
      if (editingChecklists.has(strategyId)) {
        currentChecklist = editingChecklists.get(strategyId)!;
      } else {
        // Initialize from current checklists state
        const existingChecklist = checklists.get(strategyId) || new Map<string, ChecklistItem[]>();
        currentChecklist = new Map<string, ChecklistItem[]>();
        for (const [checklistType, items] of existingChecklist.entries()) {
          currentChecklist.set(checklistType, items.map(item => ({ ...item })));
        }
        setEditingChecklists(new Map(editingChecklists.set(strategyId, currentChecklist)));
        
        // Initialize history if needed
        if (!checklistEditHistory.has(strategyId)) {
          const originalCopy = new Map<string, ChecklistItem[]>();
          for (const [checklistType, items] of existingChecklist.entries()) {
            originalCopy.set(checklistType, items.map(item => ({ ...item })));
          }
          setChecklistEditHistory(new Map(checklistEditHistory.set(strategyId, [originalCopy])));
        }
      }
      
      const items = currentChecklist.get(type) || [];
      const maxOrder = items.length > 0 ? Math.max(...items.map(i => i.item_order)) : -1;
      
      // Calculate order: if adding to a group, order within that group; otherwise top-level order
      let itemOrder = maxOrder + 1;
      if (parentId) {
        const groupChildren = items.filter(i => i.parent_id === parentId);
        if (groupChildren.length > 0) {
          itemOrder = Math.max(...groupChildren.map(i => i.item_order)) + 1;
        } else {
          itemOrder = maxOrder + 1;
        }
      }
      
      const newItem: ChecklistItem = {
        id: Date.now(), // Temporary ID (will be replaced when saved)
        strategy_id: strategyId,
        item_text: text.trim(),
        is_checked: false,
        item_order: itemOrder,
        checklist_type: type,
        parent_id: parentId,
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
      
      // Calculate order: if adding to a group, order within that group; otherwise top-level order
      let itemOrder = maxOrder + 1;
      if (parentId) {
        const groupChildren = items.filter(i => i.parent_id === parentId);
        if (groupChildren.length > 0) {
          itemOrder = Math.max(...groupChildren.map(i => i.item_order)) + 1;
        } else {
          itemOrder = maxOrder + 1;
        }
      }
      
      const newId = await invoke<number>("save_strategy_checklist_item", {
        id: null,
        strategyId: strategyId,
        itemText: text.trim(),
        isChecked: false,
        itemOrder: itemOrder,
        checklistType: type,
        parentId: parentId,
      });

      const newItem: ChecklistItem = {
        id: newId,
        strategy_id: strategyId,
        item_text: text.trim(),
        is_checked: false,
        item_order: itemOrder,
        checklist_type: type,
        parent_id: parentId,
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
    if (isEditing) {
      // Initialize editingChecklists if it doesn't have this strategy yet
      let currentChecklist: Map<string, ChecklistItem[]>;
      if (editingChecklists.has(strategyId)) {
        currentChecklist = editingChecklists.get(strategyId)!;
      } else {
        // Initialize from current checklists state
        const existingChecklist = checklists.get(strategyId) || new Map<string, ChecklistItem[]>();
        currentChecklist = new Map<string, ChecklistItem[]>();
        for (const [checklistType, items] of existingChecklist.entries()) {
          currentChecklist.set(checklistType, items.map(item => ({ ...item })));
        }
        setEditingChecklists(new Map(editingChecklists.set(strategyId, currentChecklist)));
        
        // Initialize history if needed
        if (!checklistEditHistory.has(strategyId)) {
          const originalCopy = new Map<string, ChecklistItem[]>();
          for (const [checklistType, items] of existingChecklist.entries()) {
            originalCopy.set(checklistType, items.map(item => ({ ...item })));
          }
          setChecklistEditHistory(new Map(checklistEditHistory.set(strategyId, [originalCopy])));
        }
      }
      
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

  const moveItemsToGroup = async (itemIds: number[], groupId: number, checklistType: string) => {
    if (itemIds.length === 0 || !groupId) return;
    
    // If creating, update tempChecklists
    if (isCreating) {
      const updatedChecklist = new Map(tempChecklists);
      const items = updatedChecklist.get(checklistType) || [];
      
      // Calculate max order within the target group (excluding items being moved)
      const groupChildren = items.filter(i => i.parent_id === groupId && !itemIds.includes(i.id));
      const maxGroupOrder = groupChildren.length > 0 ? Math.max(...groupChildren.map(i => i.item_order)) : -1;
      
      let orderOffset = 0;
      const updatedItems = items.map(item => {
        if (itemIds.includes(item.id)) {
          // Set parent_id and update order to be after the last item in the group
          const newOrder = maxGroupOrder + 1 + orderOffset;
          orderOffset++;
          return { ...item, parent_id: groupId, item_order: newOrder };
        }
        return item;
      });
      updatedChecklist.set(checklistType, updatedItems);
      setTempChecklists(updatedChecklist);
      setSelectedChecklistItems(new Set());
      return;
    }
    
    // If editing, use editingChecklists instead of saving directly
    if (isEditing && selectedStrategy && editingChecklists.has(selectedStrategy)) {
      const updatedChecklist = new Map(editingChecklists.get(selectedStrategy)!);
      const items = updatedChecklist.get(checklistType) || [];
      
      // Calculate max order within the target group (excluding items being moved)
      const groupChildren = items.filter(i => i.parent_id === groupId && !itemIds.includes(i.id));
      const maxGroupOrder = groupChildren.length > 0 ? Math.max(...groupChildren.map(i => i.item_order)) : -1;
      
      let orderOffset = 0;
      const updatedItems = items.map(item => {
        if (itemIds.includes(item.id)) {
          // Set parent_id and update order to be after the last item in the group
          const newOrder = maxGroupOrder + 1 + orderOffset;
          orderOffset++;
          return { ...item, parent_id: groupId, item_order: newOrder };
        }
        return item;
      });
      updatedChecklist.set(checklistType, updatedItems);
      setEditingChecklists(new Map(editingChecklists.set(selectedStrategy, updatedChecklist)));
      
      // Update history
      const history = checklistEditHistory.get(selectedStrategy) || [];
      const newHistory = [...history, new Map(updatedChecklist)].slice(-10);
      setChecklistEditHistory(new Map(checklistEditHistory.set(selectedStrategy, newHistory)));
      
      setSelectedChecklistItems(new Set());
      return;
    }
    
    // Otherwise, save directly (shouldn't happen in non-editing mode, but handle it)
    try {
      // Load current items to calculate order
      const allItems = await invoke<ChecklistItem[]>("get_strategy_checklist", {
        strategyId: selectedStrategy!,
        checklistType: checklistType,
      });
      
      // Calculate max order within the target group (excluding items being moved)
      const groupChildren = allItems.filter(i => i.parent_id === groupId && !itemIds.includes(i.id));
      const maxGroupOrder = groupChildren.length > 0 ? Math.max(...groupChildren.map(i => i.item_order)) : -1;
      
      // Update each item
      let orderOffset = 0;
      for (const itemId of itemIds) {
        const item = allItems.find(i => i.id === itemId);
        if (item) {
          const newOrder = maxGroupOrder + 1 + orderOffset;
          await invoke("save_strategy_checklist_item", {
            id: itemId,
            strategyId: selectedStrategy!,
            itemText: item.item_text,
            isChecked: item.is_checked,
            itemOrder: newOrder,
            checklistType: checklistType,
            parentId: groupId,
          });
          orderOffset++;
        }
      }
      
      setSelectedChecklistItems(new Set());
      if (selectedStrategy) {
        await loadChecklists(selectedStrategy);
      }
    } catch (error) {
      console.error("Error moving items to group:", error);
      alert("Failed to move items to group: " + error);
    }
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
    clearWorkInProgress(); // Clear any old work in progress
    setIsCreating(true);
    setIsEditing(false);
    setSelectedStrategy(null);
    setEditingFormData({ name: "", description: "", color: "#3b82f6" });
    setNewStrategyNotes("");
    setTempChecklists(new Map()); // Explicitly clear temp checklists when creating new strategy
    setActiveTab("notes");
    tabScrollPositions.current.clear();
  };

  const handleImportCSVForStrategy = async () => {
    try {
      setIsImportingCSV(true);
      const files = await open({
        filters: [{ name: "CSV", extensions: ["csv"] }],
        multiple: true,
      });

      if (!files) {
        setIsImportingCSV(false);
        return;
      }

      // Handle both string (single file) and array (multiple files) cases
      const fileArray = Array.isArray(files) ? files : [files];
      const validFiles = fileArray.filter((f): f is string => typeof f === "string");
      
      if (validFiles.length > 0) {
        // Store the files and show format selection modal
        setPendingCSVFiles(validFiles.map(path => ({ path, isForExisting: false })));
        setShowCSVFormatModal(true);
        setIsImportingCSV(false);
      } else {
        alert("Please select valid CSV files.");
        setIsImportingCSV(false);
      }
    } catch (error) {
      console.error("Error importing CSV:", error);
      alert("Failed to import CSV: " + (error instanceof Error ? error.message : String(error)));
      setIsImportingCSV(false);
    }
  };

  // Helper function to count trades in CSV content
  const countTradesInCSV = (csvContent: string): number => {
    try {
      const lines = csvContent.split('\n').filter(line => line.trim().length > 0);
      // Subtract 1 for header row, but ensure at least 0
      return Math.max(0, lines.length - 1);
    } catch {
      return 0;
    }
  };

  const handleCSVFormatSelection = async (_format: "webull" | "coinbase") => {
    if (pendingCSVFiles.length === 0 && !pendingCSVFile) return;
    
    // Support both old single file and new multiple files
    const filesToProcess = pendingCSVFiles.length > 0 
      ? pendingCSVFiles 
      : (pendingCSVFile ? [pendingCSVFile] : []);
    
    if (filesToProcess.length === 0) return;
    
    try {
      setIsImportingCSV(true);
      setShowCSVFormatModal(false);
      
      let totalAttempted = 0;
      let totalNewTrades = 0;
      let totalDuplicates = 0;
      let totalErrors = 0;
      const allImportedTradeIds: number[] = [];
      
      // Process each file
      for (const fileInfo of filesToProcess) {
        try {
          const contents = await readTextFile(fileInfo.path);
          const tradesInFile = countTradesInCSV(contents);
          totalAttempted += tradesInFile;
          
          const importedTradeIds = await invoke<number[]>("import_trades_csv", { csvData: contents });
          
          if (importedTradeIds && importedTradeIds.length > 0) {
            allImportedTradeIds.push(...importedTradeIds);
            totalNewTrades += importedTradeIds.length;
            // Calculate duplicates for this file
            const duplicatesInFile = tradesInFile - importedTradeIds.length;
            totalDuplicates += duplicatesInFile;
          } else {
            // All trades in this file were duplicates
            totalDuplicates += tradesInFile;
          }
        } catch (error) {
          totalErrors++;
          console.error(`Error importing file ${fileInfo.path}:`, error);
        }
      }
      
      // Set import results for UI display
      setImportResults({
        totalAttempted,
        newTrades: totalNewTrades,
        duplicates: totalDuplicates,
        errors: totalErrors,
      });
      
      if (filesToProcess[0].isForExisting) {
        // Handle existing strategy import
        if (!selectedStrategy) {
          setIsImportingCSV(false);
          setPendingCSVFiles([]);
          setPendingCSVFile(null);
          return;
        }
        
        if (allImportedTradeIds.length > 0) {
          // Immediately assign all imported trades to the selected strategy
          for (const tradeId of allImportedTradeIds) {
            await invoke("update_trade_strategy", { tradeId, strategyId: selectedStrategy });
          }
          
          // Switch to Trades tab to show the imported trades immediately
          setActiveTab("trades");
          
          // Set loading state
          setLoadingPairs(new Set([selectedStrategy]));
          
          // Reload trades for this strategy
          try {
            const pairingMethod = localStorage.getItem("tradebutler_pairing_method") || "FIFO";
            const pairs = await invoke<PairedTrade[]>("get_paired_trades_by_strategy", {
              strategyId: selectedStrategy,
              pairingMethod: pairingMethod,
              startDate: null,
              endDate: null,
            });
            
            // Update pairs and stats
            setStrategyPairs(new Map(strategyPairs.set(selectedStrategy, pairs)));
            const stats = calculateStrategyStats(pairs);
            setStrategyStats(new Map(strategyStats.set(selectedStrategy, stats)));
          } catch (error) {
            console.error("Error loading trades after import:", error);
          } finally {
            // Clear loading state
            setLoadingPairs(prev => {
              const newSet = new Set(prev);
              newSet.delete(selectedStrategy);
              return newSet;
            });
          }
        }
      } else {
        // Handle new strategy import
        if (allImportedTradeIds.length > 0) {
          setPendingTradeIds(prev => [...prev, ...allImportedTradeIds]);
          
          // Switch to Trades tab to show imported trades
          setActiveTab("trades");
          
          // Get all paired trades and filter to show only the imported ones
          // This allows us to display trades immediately even for new strategies
          try {
            setLoadingPairs(new Set([-1])); // Use -1 as a temporary ID for new strategies
            
            const pairingMethod = localStorage.getItem("tradebutler_pairing_method") || "FIFO";
            const allPairs = await invoke<PairedTrade[]>("get_paired_trades", {
              pairingMethod: pairingMethod || null,
            });
            
            // Filter to only pairs where both entry and exit trades are in our imported list
            const importedTradeIdsSet = new Set(allImportedTradeIds);
            const filteredPairs = allPairs.filter(pair => 
              importedTradeIdsSet.has(pair.entry_trade_id) && 
              importedTradeIdsSet.has(pair.exit_trade_id)
            );
            
            // Store pairs with temporary key for new strategies
            setStrategyPairs(new Map(strategyPairs.set(-1, filteredPairs)));
            
            // Update stats for the imported trades
            const stats = calculateStrategyStats(filteredPairs);
            setStrategyStats(new Map(strategyStats.set(-1, stats)));
          } catch (error) {
            console.error("Error loading imported trades for new strategy:", error);
          } finally {
            setLoadingPairs(prev => {
              const newSet = new Set(prev);
              newSet.delete(-1);
              return newSet;
            });
          }
        }
      }
      
      setPendingCSVFiles([]);
      setPendingCSVFile(null);
    } catch (error) {
      console.error("Error importing CSV:", error);
      alert("Failed to import CSV: " + (error instanceof Error ? error.message : String(error)));
      setImportResults(null);
    } finally {
      setIsImportingCSV(false);
    }
  };

  const handleImportCSVForExistingStrategy = async () => {
    if (!selectedStrategy) return;
    
    try {
      setIsImportingCSV(true);
      const files = await open({
        filters: [{ name: "CSV", extensions: ["csv"] }],
        multiple: true,
      });

      if (!files) {
        setIsImportingCSV(false);
        return;
      }

      // Handle both string (single file) and array (multiple files) cases
      const fileArray = Array.isArray(files) ? files : [files];
      const validFiles = fileArray.filter((f): f is string => typeof f === "string");
      
      if (validFiles.length > 0) {
        // Store the files and show format selection modal
        setPendingCSVFiles(validFiles.map(path => ({ path, isForExisting: true })));
        setShowCSVFormatModal(true);
        setIsImportingCSV(false);
      } else {
        alert("Please select valid CSV files.");
        setIsImportingCSV(false);
      }
    } catch (error) {
      console.error("Error importing CSV:", error);
      alert("Failed to import CSV: " + (error instanceof Error ? error.message : String(error)));
      setIsImportingCSV(false);
    }
  };

  const handleAddTradeSubmit = async () => {
    setAddTradeError(null);
    const qty = parseFloat(addTradeForm.quantity);
    const pr = parseFloat(addTradeForm.price);
    const feeVal = addTradeForm.fees.trim() === "" ? null : parseFloat(addTradeForm.fees);
    if (!addTradeForm.symbol.trim()) {
      setAddTradeError("Symbol is required.");
      return;
    }
    if (isNaN(qty) || qty <= 0) {
      setAddTradeError("Quantity must be a positive number.");
      return;
    }
    if (isNaN(pr) || pr < 0) {
      setAddTradeError("Price must be a non-negative number.");
      return;
    }
    // ISO 8601: YYYY-MM-DDTHH:mm:ssZ
    const timestamp = `${addTradeForm.tradeDate}T${addTradeForm.tradeTime}:00Z`;
    // Auto-assign to the strategy the user had selected when they clicked Add Trade (captured in ref when modal opened)
    const strategyId = isCreating ? null : (addTradeStrategyIdRef.current ?? null);
    try {
      setIsAddingTrade(true);
      const newId = await invoke<number>("add_trade_manual", {
        symbol: addTradeForm.symbol.trim(),
        side: addTradeForm.side,
        quantity: qty,
        price: pr,
        timestamp,
        order_type: addTradeForm.orderType || null,
        fees: feeVal,
        notes: addTradeForm.notes.trim() || null,
        strategy_id: strategyId,
      });
      setShowAddTradeModal(false);
      setAddTradeForm({
        symbol: "",
        side: "BUY",
        quantity: "",
        price: "",
        tradeDate: format(new Date(), "yyyy-MM-dd"),
        tradeTime: format(new Date(), "HH:mm"),
        orderType: "MARKET",
        fees: "",
        notes: "",
      });
      if (isCreating) {
        const newPendingIds = [...pendingTradeIds, newId];
        setPendingTradeIds(newPendingIds);
        setActiveTab("trades");
        setLoadingPairs(new Set([-1]));
        try {
          const pairingMethod = localStorage.getItem("tradebutler_pairing_method") || "FIFO";
          const allPairs = await invoke<PairedTrade[]>("get_paired_trades", { pairingMethod: pairingMethod || null });
          const importedSet = new Set(newPendingIds);
          const filteredPairs = allPairs.filter(pair =>
            importedSet.has(pair.entry_trade_id) && importedSet.has(pair.exit_trade_id)
          );
          setStrategyPairs(new Map(strategyPairs.set(-1, filteredPairs)));
          const stats = calculateStrategyStats(filteredPairs);
          setStrategyStats(new Map(strategyStats.set(-1, stats)));
        } catch (e) {
          console.error("Error loading pairs after add trade:", e);
        } finally {
          setLoadingPairs(prev => { const s = new Set(prev); s.delete(-1); return s; });
        }
      } else {
        const assignedStrategyId = addTradeStrategyIdRef.current;
        if (assignedStrategyId != null) {
          await invoke("update_trade_strategy", { tradeId: newId, strategyId: assignedStrategyId });
          setActiveTab("trades");
          setLoadingPairs(new Set([assignedStrategyId]));
          try {
            const pairingMethod = localStorage.getItem("tradebutler_pairing_method") || "FIFO";
            const pairs = await invoke<PairedTrade[]>("get_paired_trades_by_strategy", {
              strategyId: assignedStrategyId,
              pairingMethod,
              startDate: null,
              endDate: null,
            });
            setStrategyPairs(new Map(strategyPairs.set(assignedStrategyId, pairs)));
            const stats = calculateStrategyStats(pairs);
            setStrategyStats(new Map(strategyStats.set(assignedStrategyId, stats)));
          } catch (e) {
            console.error("Error loading pairs after add trade:", e);
          } finally {
            setLoadingPairs(prev => { const s = new Set(prev); s.delete(assignedStrategyId); return s; });
          }
        }
      }
    } catch (err) {
      setAddTradeError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsAddingTrade(false);
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
      isSavingOrCancelingRef.current = true; // Prevent state restoration during save
      clearWorkInProgress(); // Clear work in progress when saving
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

        // Third pass: Persist empty custom checklist types with a placeholder item so they display when viewing
        const defaultTypes = ["entry", "take_profit"];
        for (const [type, items] of tempChecklists.entries()) {
          if (defaultTypes.includes(type) || type === "survey") continue;
          if (items.length > 0) continue;
          await invoke<number>("save_strategy_checklist_item", {
            id: null,
            strategyId: newStrategyId,
            itemText: EMPTY_CUSTOM_CHECKLIST_PLACEHOLDER,
            isChecked: false,
            itemOrder: 0,
            checklistType: type,
            parentId: null,
          });
        }
      }

      // Reset and reload
      setIsCreating(false);
      setIsEditing(false); // Ensure we're in view mode, not edit mode
      setNewStrategyNotes("");
      setEditingFormData({ name: "", description: "", color: "#3b82f6" });
      setPendingTradeIds([]);
      setTempChecklists(new Map());
      setImportResults(null); // Clear any import results
      
      // Clear work-in-progress AFTER setting isCreating to false to prevent restoration
      clearWorkInProgress();
      
      await loadStrategies();
      // Select the newly created strategy
      setSelectedStrategy(newStrategyId);
      
      // Always load checklists for the new strategy to ensure custom checklists are loaded
      await loadChecklists(newStrategyId);
      
      // Always load strategy data to display it properly
      await loadStrategyData(newStrategyId);
      
      // If there were pending trades, reload trades
      if (hadPendingTrades) {
        // Clear the cached pairs so they reload
        const updatedPairs = new Map(strategyPairs);
        updatedPairs.delete(newStrategyId);
        setStrategyPairs(updatedPairs);
        // Reload trades for the new strategy
        const pairingMethod = localStorage.getItem("tradebutler_pairing_method") || "FIFO";
        const pairs = await invoke<PairedTrade[]>("get_paired_trades_by_strategy", {
          strategyId: newStrategyId,
          pairingMethod: pairingMethod,
          startDate: null,
          endDate: null,
        });
        setStrategyPairs(new Map(strategyPairs.set(newStrategyId, pairs)));
        // Update stats
        const stats = calculateStrategyStats(pairs);
        setStrategyStats(new Map(strategyStats.set(newStrategyId, stats)));
      }
      
      // Always switch to Details tab after saving
      setActiveTab("notes");
      
      // Clear work-in-progress one more time after all state updates to prevent restoration
      clearWorkInProgress();
      
      // Scroll to the selected strategy in the list
      setTimeout(() => {
        if (leftPanelScrollRef.current) {
          const strategyElement = leftPanelScrollRef.current.querySelector(`[data-strategy-id="${newStrategyId}"]`);
          if (strategyElement) {
            strategyElement.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }
        }
        // Final clear to ensure work-in-progress is not restored
        clearWorkInProgress();
      }, 300);
    } catch (error) {
      console.error("Error creating strategy:", error);
      alert("Failed to create strategy: " + error);
    }
  };

  const handleCancelNew = () => {
    isSavingOrCancelingRef.current = true; // Prevent state restoration during cancel
    clearWorkInProgress(); // Clear work in progress when canceling
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
    
    // Create ID mapping for new items (temporary IDs to new database IDs)
    const idMap = new Map<number, number>();
    
    // First pass: Save all parent items (groups) first
    for (const [type, items] of editingChecklist.entries()) {
      // Filter to only parent items (groups)
      const parentItems = items.filter(item => !item.parent_id);
      
      // Save parent items first
      for (const item of parentItems) {
        const originalItem = allOriginalItems.get(item.id);
        const isNew = !originalItem;
        const hasChanged = isNew || (originalItem && (
          originalItem.item_text !== item.item_text ||
          originalItem.item_order !== item.item_order ||
          originalItem.parent_id !== item.parent_id ||
          originalItem.checklist_type !== item.checklist_type
        ));
        
        if (isNew || hasChanged) {
          const newId = await invoke<number>("save_strategy_checklist_item", {
            id: isNew ? null : item.id,
            strategyId: strategyId,
            itemText: item.item_text,
            isChecked: item.is_checked,
            itemOrder: item.item_order,
            checklistType: type,
            parentId: null,
          });
          
          // If it's a new item, map the old temporary ID to the new database ID
          if (isNew) {
            idMap.set(item.id, newId);
          }
        }
      }
    }
    
    // Second pass: Save all child items with updated parent IDs
    for (const [type, items] of editingChecklist.entries()) {
      const childItems = items.filter(item => item.parent_id !== null);
      
      for (const item of childItems) {
        const originalItem = allOriginalItems.get(item.id);
        const isNew = !originalItem;
        
        // Get the correct parent ID (either from idMap if parent was new, or use existing)
        let correctParentId = item.parent_id;
        if (idMap.has(item.parent_id!)) {
          correctParentId = idMap.get(item.parent_id!)!;
        }
        
        const hasChanged = isNew || (originalItem && (
          originalItem.item_text !== item.item_text ||
          originalItem.item_order !== item.item_order ||
          originalItem.parent_id !== correctParentId ||
          originalItem.checklist_type !== item.checklist_type
        ));
        
        if (isNew || hasChanged) {
          const newId = await invoke<number>("save_strategy_checklist_item", {
            id: isNew ? null : item.id,
            strategyId: strategyId,
            itemText: item.item_text,
            isChecked: item.is_checked,
            itemOrder: item.item_order,
            checklistType: type,
            parentId: correctParentId,
          });
          
          // If it's a new item, map the old temporary ID to the new database ID
          if (isNew) {
            idMap.set(item.id, newId);
          }
        }
      }
    }
    
    // Third pass: Persist empty custom checklist types with a placeholder item so they display when viewing
    const defaultTypes = ["entry", "take_profit"];
    for (const [type, items] of editingChecklist.entries()) {
      if (defaultTypes.includes(type) || type === "survey") continue;
      if (items.length > 0) continue;
      
      // Check if this type existed in the original checklist
      const originalItems = originalChecklist.get(type) || [];
      // Only create placeholder if this is a new type (didn't exist before)
      if (originalItems.length === 0) {
        await invoke<number>("save_strategy_checklist_item", {
          id: null,
          strategyId: strategyId,
          itemText: EMPTY_CUSTOM_CHECKLIST_PLACEHOLDER,
          isChecked: false,
          itemOrder: 0,
          checklistType: type,
          parentId: null,
        });
      }
    }
    
    // Reload checklists to get updated IDs for new items
    await loadChecklists(strategyId);
  };

  const handleSaveEdit = async () => {
    isSavingOrCancelingRef.current = true; // Prevent state restoration during save
    clearWorkInProgress(); // Clear work in progress when saving
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
      // Save the strategy ID before clearing editing state
      const savedStrategyId = selectedStrategyData.id;
      
      // Reload strategies - this will update the strategies array
      await loadStrategies(true);
      
      // Clear work-in-progress AFTER loading strategies to prevent restoration
      clearWorkInProgress();
      
      // After reload, ensure selectedStrategy is still set (this will update selectedStrategyData)
      if (savedStrategyId) {
        setSelectedStrategy(savedStrategyId);
        // Update notesContent with saved notes
        setNotesContent(prev => {
          const updated = new Map(prev);
          updated.set(savedStrategyId, currentNotes || "");
          return updated;
        });
        
        await loadStrategyData(savedStrategyId);
        await loadChecklists(savedStrategyId);
        
        // Switch to Details tab after saving
        setActiveTab("notes");
        
        // Scroll to the selected strategy in the list
        setTimeout(() => {
          if (leftPanelScrollRef.current) {
            const strategyElement = leftPanelScrollRef.current.querySelector(`[data-strategy-id="${savedStrategyId}"]`);
            if (strategyElement) {
              strategyElement.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }
          }
          // Final clear to ensure work-in-progress is not restored
          clearWorkInProgress();
        }, 300);
      }
    } catch (error) {
      console.error("Error saving strategy:", error);
      alert("Failed to save strategy: " + error);
    }
  };

  const handleCancelEdit = () => {
    isSavingOrCancelingRef.current = true; // Prevent state restoration during cancel
    clearWorkInProgress(); // Clear work in progress when canceling
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

  const handleDeleteClick = async (id: number) => {
    setStrategyToDelete(id);
    setLoadingAssociatedRecords(true);
    setShowDeleteConfirmModal(true);
    
    try {
      const records = await invoke<{
        trade_count: number;
        journal_entry_count: number;
        checklist_item_count: number;
        sample_trades: Array<[number, string, string, string]>;
        sample_journal_entries: Array<[number, string, string]>;
      }>("get_strategy_associated_records", { strategyId: id });
      setAssociatedRecords(records);
    } catch (error) {
      console.error("Error fetching associated records:", error);
      setAssociatedRecords(null);
    } finally {
      setLoadingAssociatedRecords(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!strategyToDelete) return;
    
    try {
      await invoke("delete_strategy", { id: strategyToDelete });
      if (selectedStrategy === strategyToDelete) {
        setSelectedStrategy(null);
      }
      await loadStrategies();
      setShowDeleteConfirmModal(false);
      setStrategyToDelete(null);
      setAssociatedRecords(null);
    } catch (error) {
      console.error("Error deleting strategy:", error);
      alert("Failed to delete strategy: " + error);
    }
  };

  const handleDeleteCancel = () => {
    setShowDeleteConfirmModal(false);
    setStrategyToDelete(null);
    setAssociatedRecords(null);
  };

  const handleStrategyDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    
    // Use sortedStrategies to find indices since that's what's being displayed
    const oldIndex = sortedStrategies.findIndex(s => s.id === active.id);
    const newIndex = sortedStrategies.findIndex(s => s.id === over.id);
    
    if (oldIndex === -1 || newIndex === -1) return;
    
    // Reorder the sortedStrategies array
    const reorderedStrategies = arrayMove(sortedStrategies, oldIndex, newIndex);
    
    // Update the strategyOrder state with the new order
    const newOrder = reorderedStrategies.map(s => s.id!);
    setStrategyOrder(newOrder);
    localStorage.setItem(STRATEGY_ORDER_KEY, JSON.stringify(newOrder));
    
    // Update display_order for all strategies in the database
    const strategyOrders = reorderedStrategies.map((strategy, index) => [strategy.id, index]);
    
    try {
      await invoke("update_strategy_order", { strategyOrders });
      // Reload strategies to ensure everything is in sync
      await loadStrategies();
    } catch (error) {
      console.error("Error updating strategy order:", error);
      alert("Failed to update strategy order: " + error);
      // Revert the order change on error
      const saved = localStorage.getItem(STRATEGY_ORDER_KEY);
      if (saved) {
        try {
          setStrategyOrder(JSON.parse(saved));
        } catch {
          setStrategyOrder([]);
        }
      }
    }
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
  const pairs = isCreating 
    ? (strategyPairs.get(-1) || []) 
    : (selectedStrategy ? strategyPairs.get(selectedStrategy) || [] : []);
  const isLoadingPairs = isCreating 
    ? loadingPairs.has(-1) 
    : (selectedStrategy ? loadingPairs.has(selectedStrategy) : false);
  const displayStats = isCreating 
    ? strategyStats.get(-1) 
    : (selectedStrategy ? strategyStats.get(selectedStrategy) : null);

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

        <div 
          ref={leftPanelScrollRef}
          style={{ flex: 1, overflowY: "auto", padding: "12px" }}
        >

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
            <DndContext
              sensors={strategySensors}
              collisionDetection={closestCenter}
              onDragEnd={handleStrategyDragEnd}
            >
              <SortableContext items={sortedStrategies.map(s => s.id!)} strategy={verticalListSortingStrategy}>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {sortedStrategies.map((strategy) => {
                    const isSelected = selectedStrategy === strategy.id;
                    return (
                      <SortableStrategy
                        key={strategy.id}
                        strategy={strategy}
                        isSelected={isSelected}
                        selectedStrategy={selectedStrategy}
                        strategyStats={strategyStats}
                        expandedStats={expandedStats}
                        setExpandedStats={setExpandedStats}
                        onSelect={() => {}}
                        saveAllScrollPositions={saveAllScrollPositions}
                        tabScrollPositions={tabScrollPositions}
                        leftPanelScrollRef={leftPanelScrollRef}
                        rightPanelScrollRef={rightPanelScrollRef}
                        clearWorkInProgress={clearWorkInProgress}
                        setSelectedStrategy={setSelectedStrategy}
                        setActiveTab={setActiveTab}
                        setIsEditing={setIsEditing}
                        setIsCreating={setIsCreating}
                      />
                    );
                  })}
                </div>
              </SortableContext>
            </DndContext>
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
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSaveNew();
                      }}
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
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCancelNew();
                      }}
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
                      onClick={(e) => {
                        e.stopPropagation();
                        if (selectedStrategyData?.id) {
                          handleDeleteClick(selectedStrategyData.id);
                        }
                      }}
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
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSaveEdit();
                      }}
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
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCancelEdit();
                      }}
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
                    <ColorPicker
                      value={editingFormData.color || "#3b82f6"}
                      onChange={(newColor) => {
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
                    onClick={() => {
                      // Save current active tab's scroll position
                      const currentTabContent = tabContentRefs.current.get(activeTab);
                      if (currentTabContent) {
                        // Tab has its own scroll container
                        tabScrollPositions.current.set(activeTab, currentTabContent.scrollTop);
                      } else if (rightPanelScrollRef.current && activeTab === "notes") {
                        // Notes tab uses the right panel scroll
                        tabScrollPositions.current.set(activeTab, rightPanelScrollRef.current.scrollTop);
                      }
                      
                      // Save all scroll positions (tabs + panels) to localStorage before switching
                      saveAllScrollPositions(
                        tabScrollPositions.current,
                        leftPanelScrollRef.current?.scrollTop ?? null,
                        rightPanelScrollRef.current?.scrollTop ?? null,
                        "strategies"
                      );
                      
                      // Switch to new tab
                      setActiveTab(tab.id);
                    }}
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
            <div 
              ref={rightPanelScrollRef}
              style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}
              onScroll={(e) => {
                // Save scroll position for notes tab (which uses the right panel scroll)
                if (activeTab === "notes") {
                  tabScrollPositions.current.set("notes", e.currentTarget.scrollTop);
                }
              }}
            >
              {activeTab === "notes" && (selectedStrategy !== null || isCreating) && (
                <div>
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
                </div>
              )}

              {activeTab === "trades" && (
                <div 
                  ref={(el) => { tabContentRefs.current.set("trades", el); }}
                  style={{ padding: "20px", overflowY: "auto" }}
                  onScroll={(e) => { 
                    if (activeTab === "trades") {
                      tabScrollPositions.current.set("trades", e.currentTarget.scrollTop);
                    }
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
                    <h3 style={{ fontSize: "18px", fontWeight: "600" }}>Trades</h3>
                    {(isCreating || selectedStrategy) && (
                      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
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
                        <button
                          onClick={() => {
                          setAddTradeError(null);
                          addTradeStrategyIdRef.current = selectedStrategy;
                          setShowAddTradeModal(true);
                        }}
                          style={{
                            background: "var(--bg-tertiary)",
                            border: "1px solid var(--border-color)",
                            borderRadius: "6px",
                            padding: "8px 12px",
                            color: "var(--text-primary)",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            fontSize: "13px",
                            fontWeight: "500",
                          }}
                        >
                          <Plus size={16} />
                          Add Trade
                        </button>
                      </div>
                    )}
                  </div>
                  {/* Import Results Banner - for both creating and existing strategies */}
                  {importResults && (
                    <div style={{
                      padding: "16px",
                      marginBottom: "16px",
                      backgroundColor: importResults && importResults.duplicates > 0 ? "var(--warning)" : "var(--accent)",
                      borderRadius: "8px",
                      border: `2px solid ${importResults && importResults.duplicates > 0 ? "var(--warning)" : "var(--accent)"}`,
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "12px",
                      boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)"
                    }}>
                      <div style={{
                        width: "40px",
                        height: "40px",
                        borderRadius: "50%",
                        backgroundColor: "rgba(255, 255, 255, 0.2)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0
                      }}>
                        {importResults && importResults.duplicates > 0 ? (
                          <AlertTriangle size={20} color="white" />
                        ) : (
                          <CheckCircle size={20} color="white" />
                        )}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ 
                          color: "white", 
                          fontSize: "16px", 
                          fontWeight: "600",
                          marginBottom: "8px"
                        }}>
                          {importResults 
                            ? (importResults.duplicates > 0 
                                ? "Import Complete with Warnings" 
                                : "Trades Imported Successfully!")
                            : "Trades Imported Successfully!"
                          }
                        </div>
                        {importResults ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                            <div style={{ 
                              color: "rgba(255, 255, 255, 0.95)", 
                              fontSize: "14px"
                            }}>
                              <strong>{importResults.newTrades}</strong> new trade{importResults.newTrades !== 1 ? "s" : ""} imported
                              {importResults.duplicates > 0 && (
                                <span style={{ display: "block", marginTop: "4px", color: "rgba(255, 255, 255, 0.9)", fontSize: "13px" }}>
                                  ⚠️ <strong>{importResults.duplicates}</strong> duplicate trade{importResults.duplicates !== 1 ? "s" : ""} skipped (already exist in database)
                                </span>
                              )}
                              {importResults.errors > 0 && (
                                <span style={{ display: "block", marginTop: "4px", color: "rgba(255, 200, 200, 0.95)", fontSize: "13px" }}>
                                  ❌ <strong>{importResults.errors}</strong> file{importResults.errors !== 1 ? "s" : ""} failed to import
                                </span>
                              )}
                            </div>
                            {isCreating && importResults.newTrades > 0 && (
                              <div style={{ 
                                color: "rgba(255, 255, 255, 0.85)", 
                                fontSize: "13px",
                                marginTop: "4px",
                                fontStyle: "italic"
                              }}>
                                {importResults.newTrades} trade{importResults.newTrades !== 1 ? "s" : ""} {importResults.newTrades === 1 ? "will be" : "will be"} assigned to this strategy when you save.
                              </div>
                            )}
                          </div>
                        ) : (
                          <div style={{ 
                            color: "rgba(255, 255, 255, 0.9)", 
                            fontSize: "14px"
                          }}>
                            {pendingTradeIds.length} trade{pendingTradeIds.length !== 1 ? "s" : ""} {pendingTradeIds.length === 1 ? "has" : "have"} been imported and {pendingTradeIds.length === 1 ? "will be" : "will be"} assigned to this strategy when you save.
                          </div>
                        )}
                      </div>
                      {importResults && (
                        <button
                          onClick={() => setImportResults(null)}
                          style={{
                            background: "transparent",
                            border: "none",
                            color: "white",
                            cursor: "pointer",
                            padding: "4px",
                            display: "flex",
                            alignItems: "center",
                            opacity: 0.8
                          }}
                          title="Dismiss"
                        >
                          <X size={18} />
                        </button>
                      )}
                    </div>
                  )}
                  {isCreating && !displayStats && pairs.length === 0 ? (
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
                    </div>
                  ) : ((isCreating && displayStats) || (selectedStrategy && strategyStats.has(selectedStrategy))) ? (() => {
                    const stats = displayStats || (selectedStrategy ? strategyStats.get(selectedStrategy)! : null);
                    if (!stats) return null;
                    return (
                      <>
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
                      </>
                    );
                  })() : null}
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
                  : isEditing && selectedStrategy && editingChecklists.has(selectedStrategy)
                    ? Array.from(new Set(Array.from(currentChecklist.keys()).filter(t => !defaultTypes.includes(t) && t !== "survey")))
                    : (() => {
                        // When viewing (not creating/editing), combine types from currentChecklist and customChecklistTypes
                        // to ensure custom types are displayed even if they have no items
                        const checklistKeys = Array.from(currentChecklist.keys());
                        const customTypes = selectedStrategy ? Array.from(customChecklistTypes.get(selectedStrategy) || []) : [];
                        const allCustomKeys = new Set([...checklistKeys, ...customTypes]);
                        return Array.from(allCustomKeys).filter(t => !defaultTypes.includes(t) && t !== "survey");
                      })();
                const allTypes = [...defaultTypes, ...tempCustomTypes.filter(t => !defaultTypes.includes(t) && t !== "survey")];

                return (
                  <div 
                    ref={(el) => { tabContentRefs.current.set("checklists", el); }}
                    style={{ padding: "24px", overflowY: "auto" }}
                    onScroll={(e) => {
                      if (activeTab === "checklists") {
                        tabScrollPositions.current.set("checklists", e.currentTarget.scrollTop);
                      }
                    }}
                  >
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
                            moveItemsToGroup={moveItemsToGroup}
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
                  <div 
                    ref={(el) => { tabContentRefs.current.set("survey", el); }}
                    style={{ padding: "24px", overflowY: "auto" }}
                    onScroll={(e) => {
                      if (activeTab === "survey") {
                        tabScrollPositions.current.set("survey", e.currentTarget.scrollTop);
                      }
                    }}
                  >
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
                        moveItemsToGroup={moveItemsToGroup}
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
                  } else if (isEditing && selectedStrategy) {
                    // Add to editingChecklists when editing
                    // Initialize editingChecklists if it doesn't have this strategy yet
                    let currentChecklist: Map<string, ChecklistItem[]>;
                    if (editingChecklists.has(selectedStrategy)) {
                      currentChecklist = editingChecklists.get(selectedStrategy)!;
                    } else {
                      // Initialize from current checklists state
                      const existingChecklist = checklists.get(selectedStrategy) || new Map<string, ChecklistItem[]>();
                      currentChecklist = new Map<string, ChecklistItem[]>();
                      for (const [checklistType, items] of existingChecklist.entries()) {
                        currentChecklist.set(checklistType, items.map(item => ({ ...item })));
                      }
                      setEditingChecklists(new Map(editingChecklists.set(selectedStrategy, currentChecklist)));
                      
                      // Initialize history if needed
                      if (!checklistEditHistory.has(selectedStrategy)) {
                        const originalCopy = new Map<string, ChecklistItem[]>();
                        for (const [checklistType, items] of existingChecklist.entries()) {
                          originalCopy.set(checklistType, items.map(item => ({ ...item })));
                        }
                        setChecklistEditHistory(new Map(checklistEditHistory.set(selectedStrategy, [originalCopy])));
                      }
                    }
                    
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
                    } else if (isEditing && selectedStrategy) {
                      // Add to editingChecklists when editing
                      // Initialize editingChecklists if it doesn't have this strategy yet
                      let currentChecklist: Map<string, ChecklistItem[]>;
                      if (editingChecklists.has(selectedStrategy)) {
                        currentChecklist = editingChecklists.get(selectedStrategy)!;
                      } else {
                        // Initialize from current checklists state
                        const existingChecklist = checklists.get(selectedStrategy) || new Map<string, ChecklistItem[]>();
                        currentChecklist = new Map<string, ChecklistItem[]>();
                        for (const [checklistType, items] of existingChecklist.entries()) {
                          currentChecklist.set(checklistType, items.map(item => ({ ...item })));
                        }
                        setEditingChecklists(new Map(editingChecklists.set(selectedStrategy, currentChecklist)));
                        
                        // Initialize history if needed
                        if (!checklistEditHistory.has(selectedStrategy)) {
                          const originalCopy = new Map<string, ChecklistItem[]>();
                          for (const [checklistType, items] of existingChecklist.entries()) {
                            originalCopy.set(checklistType, items.map(item => ({ ...item })));
                          }
                          setChecklistEditHistory(new Map(checklistEditHistory.set(selectedStrategy, [originalCopy])));
                        }
                      }
                      
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
                maxWidth: "550px",
                maxHeight: "80vh",
                overflowY: "auto",
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
                  marginBottom: "16px",
                  lineHeight: "1.5",
                }}
              >
                Are you sure you want to delete <strong>"{strategyName}"</strong>?
              </p>
              
              {loadingAssociatedRecords ? (
                <div style={{ marginBottom: "20px", textAlign: "center", color: "var(--text-secondary)", fontSize: "13px" }}>
                  Loading associated records...
                </div>
              ) : associatedRecords && (
                <div style={{ marginBottom: "20px" }}>
                  <p
                    style={{
                      fontSize: "13px",
                      color: "var(--text-secondary)",
                      marginBottom: "12px",
                      lineHeight: "1.5",
                    }}
                  >
                    This strategy is associated with the following records:
                  </p>
                  
                  <div style={{ 
                    backgroundColor: "var(--bg-tertiary)", 
                    borderRadius: "8px", 
                    padding: "12px",
                    marginBottom: "12px",
                    border: "1px solid var(--border-color)"
                  }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {associatedRecords.trade_count > 0 && (
                        <div>
                          <div style={{ 
                            display: "flex", 
                            alignItems: "center", 
                            gap: "8px",
                            marginBottom: "4px"
                          }}>
                            <TrendingUp size={14} style={{ color: "var(--accent)" }} />
                            <span style={{ fontSize: "13px", fontWeight: "600", color: "var(--text-primary)" }}>
                              {associatedRecords.trade_count} {associatedRecords.trade_count === 1 ? "Trade" : "Trades"}
                            </span>
                          </div>
                          {associatedRecords.sample_trades.length > 0 && (
                            <div style={{ marginLeft: "22px", fontSize: "12px", color: "var(--text-secondary)" }}>
                              {associatedRecords.sample_trades.slice(0, 3).map(([id, symbol, side, timestamp]) => (
                                <div key={id} style={{ marginBottom: "2px" }}>
                                  {symbol} {side} • {new Date(timestamp).toLocaleDateString()}
                                </div>
                              ))}
                              {associatedRecords.trade_count > 3 && (
                                <div style={{ fontStyle: "italic", opacity: 0.7 }}>
                                  +{associatedRecords.trade_count - 3} more
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      
                      {associatedRecords.journal_entry_count > 0 && (
                        <div>
                          <div style={{ 
                            display: "flex", 
                            alignItems: "center", 
                            gap: "8px",
                            marginBottom: "4px"
                          }}>
                            <FileText size={14} style={{ color: "var(--accent)" }} />
                            <span style={{ fontSize: "13px", fontWeight: "600", color: "var(--text-primary)" }}>
                              {associatedRecords.journal_entry_count} Journal {associatedRecords.journal_entry_count === 1 ? "Entry" : "Entries"}
                            </span>
                          </div>
                          {associatedRecords.sample_journal_entries.length > 0 && (
                            <div style={{ marginLeft: "22px", fontSize: "12px", color: "var(--text-secondary)" }}>
                              {associatedRecords.sample_journal_entries.slice(0, 3).map(([id, date, title]) => (
                                <div key={id} style={{ marginBottom: "2px" }}>
                                  {title} • {new Date(date).toLocaleDateString()}
                                </div>
                              ))}
                              {associatedRecords.journal_entry_count > 3 && (
                                <div style={{ fontStyle: "italic", opacity: 0.7 }}>
                                  +{associatedRecords.journal_entry_count - 3} more
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      
                      {associatedRecords.checklist_item_count > 0 && (
                        <div>
                          <div style={{ 
                            display: "flex", 
                            alignItems: "center", 
                            gap: "8px",
                            marginBottom: "4px"
                          }}>
                            <ListChecks size={14} style={{ color: "var(--accent)" }} />
                            <span style={{ fontSize: "13px", fontWeight: "600", color: "var(--text-primary)" }}>
                              {associatedRecords.checklist_item_count} Checklist {associatedRecords.checklist_item_count === 1 ? "Item" : "Items"}
                            </span>
                          </div>
                        </div>
                      )}
                      
                      {associatedRecords.trade_count === 0 && 
                       associatedRecords.journal_entry_count === 0 && 
                       associatedRecords.checklist_item_count === 0 && (
                        <div style={{ fontSize: "12px", color: "var(--text-secondary)", fontStyle: "italic" }}>
                          No associated records
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <p
                    style={{
                      fontSize: "12px",
                      color: "var(--text-secondary)",
                      lineHeight: "1.5",
                    }}
                  >
                    <strong>Note:</strong> Trades will be unassigned, journal entries will lose their strategy association, and checklist items will be permanently deleted.
                  </p>
                </div>
              )}
              
              {!loadingAssociatedRecords && (
                <p
                  style={{
                    fontSize: "13px",
                    color: "var(--text-secondary)",
                    marginBottom: "20px",
                    lineHeight: "1.5",
                  }}
                >
                  This action cannot be undone.
                </p>
              )}
              <div
                style={{
                  display: "flex",
                  gap: "12px",
                  justifyContent: "flex-end",
                }}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteCancel();
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
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteConfirm();
                  }}
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

      {/* Add Trade Modal */}
      {showAddTradeModal && (
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
          onClick={() => !isAddingTrade && setShowAddTradeModal(false)}
        >
          <div
            style={{
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "12px",
              padding: "24px",
              width: "90%",
              maxWidth: "440px",
              maxHeight: "90vh",
              overflowY: "auto",
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: "18px", fontWeight: "600", marginBottom: "16px", color: "var(--text-primary)" }}>
              Add Trade
            </h3>
            <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "8px" }}>
              Add a single trade manually (works for paper trades, commons, or options).
            </p>
            {!isCreating && addTradeStrategyIdRef.current != null && (() => {
              const assignToStrategy = strategies.find((s) => s.id === addTradeStrategyIdRef.current);
              return assignToStrategy ? (
                <p style={{ fontSize: "13px", color: "var(--accent)", marginBottom: "16px", fontWeight: "500" }}>
                  This trade will be assigned to <strong>{assignToStrategy.name}</strong>.
                </p>
              ) : null;
            })()}
            {(isCreating || addTradeStrategyIdRef.current == null) && <div style={{ marginBottom: "16px" }} />}
            {addTradeError && (
              <div style={{ marginBottom: "12px", padding: "8px 12px", background: "var(--loss)", color: "white", borderRadius: "6px", fontSize: "13px" }}>
                {addTradeError}
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "500", color: "var(--text-secondary)", marginBottom: "4px" }}>Symbol *</label>
                <input
                  type="text"
                  placeholder="e.g. AAPL or AAPL251219C00150000"
                  value={addTradeForm.symbol}
                  onChange={(e) => setAddTradeForm(f => ({ ...f, symbol: e.target.value }))}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: "6px", border: "1px solid var(--border-color)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: "14px" }}
                />
              </div>
              <div style={{ display: "flex", gap: "12px" }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "500", color: "var(--text-secondary)", marginBottom: "4px" }}>Side *</label>
                  <select
                    value={addTradeForm.side}
                    onChange={(e) => setAddTradeForm(f => ({ ...f, side: e.target.value }))}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: "6px", border: "1px solid var(--border-color)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: "14px" }}
                  >
                    <option value="BUY">BUY</option>
                    <option value="SELL">SELL</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "500", color: "var(--text-secondary)", marginBottom: "4px" }}>Quantity *</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="Shares or contracts"
                    value={addTradeForm.quantity}
                    onChange={(e) => setAddTradeForm(f => ({ ...f, quantity: e.target.value }))}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: "6px", border: "1px solid var(--border-color)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: "14px" }}
                  />
                </div>
              </div>
              <div style={{ display: "flex", gap: "12px" }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "500", color: "var(--text-secondary)", marginBottom: "4px" }}>Price *</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="0.00"
                    value={addTradeForm.price}
                    onChange={(e) => setAddTradeForm(f => ({ ...f, price: e.target.value }))}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: "6px", border: "1px solid var(--border-color)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: "14px" }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "500", color: "var(--text-secondary)", marginBottom: "4px" }}>Fees (optional)</label>
                  <input
                    type="number"
                    step="any"
                    placeholder="0.00"
                    value={addTradeForm.fees}
                    onChange={(e) => setAddTradeForm(f => ({ ...f, fees: e.target.value }))}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: "6px", border: "1px solid var(--border-color)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: "14px" }}
                  />
                </div>
              </div>
              <div style={{ display: "flex", gap: "12px" }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "500", color: "var(--text-secondary)", marginBottom: "4px" }}>Date *</label>
                  <input
                    type="date"
                    value={addTradeForm.tradeDate}
                    onChange={(e) => setAddTradeForm(f => ({ ...f, tradeDate: e.target.value }))}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: "6px", border: "1px solid var(--border-color)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: "14px" }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "500", color: "var(--text-secondary)", marginBottom: "4px" }}>Time *</label>
                  <input
                    type="time"
                    value={addTradeForm.tradeTime}
                    onChange={(e) => setAddTradeForm(f => ({ ...f, tradeTime: e.target.value }))}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: "6px", border: "1px solid var(--border-color)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: "14px" }}
                  />
                </div>
              </div>
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "500", color: "var(--text-secondary)", marginBottom: "4px" }}>Order type</label>
                <select
                  value={addTradeForm.orderType}
                  onChange={(e) => setAddTradeForm(f => ({ ...f, orderType: e.target.value }))}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: "6px", border: "1px solid var(--border-color)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: "14px" }}
                >
                  <option value="MARKET">MARKET</option>
                  <option value="LIMIT">LIMIT</option>
                  <option value="DAY">DAY</option>
                  <option value="GTC">GTC</option>
                </select>
              </div>
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "500", color: "var(--text-secondary)", marginBottom: "4px" }}>Notes (optional)</label>
                <input
                  type="text"
                  placeholder="Optional notes"
                  value={addTradeForm.notes}
                  onChange={(e) => setAddTradeForm(f => ({ ...f, notes: e.target.value }))}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: "6px", border: "1px solid var(--border-color)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: "14px" }}
                />
              </div>
            </div>
            <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end", marginTop: "20px" }}>
              <button
                onClick={() => !isAddingTrade && setShowAddTradeModal(false)}
                disabled={isAddingTrade}
                style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: "6px", padding: "10px 20px", color: "var(--text-primary)", cursor: isAddingTrade ? "not-allowed" : "pointer", fontSize: "14px", fontWeight: "500" }}
              >
                Cancel
              </button>
              <button
                onClick={handleAddTradeSubmit}
                disabled={isAddingTrade}
                style={{ background: "var(--accent)", border: "none", borderRadius: "6px", padding: "10px 20px", color: "white", cursor: isAddingTrade ? "not-allowed" : "pointer", fontSize: "14px", fontWeight: "500", opacity: isAddingTrade ? 0.7 : 1 }}
              >
                {isAddingTrade ? "Adding..." : "Add Trade"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
