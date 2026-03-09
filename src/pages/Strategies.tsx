import React, { useEffect, useState, useRef, Dispatch, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { open } from "@tauri-apps/api/dialog";
import { readTextFile } from "@tauri-apps/api/fs";
import { Plus, Edit2, Trash2, Target, Maximize2, Minimize2, FileText, TrendingUp, ListChecks, GripVertical, X, FolderPlus, ChevronDown, ChevronUp, Folder, ChevronRight, Upload, RotateCcw, ClipboardList, Copy, CopyMinus, AlertTriangle, CheckCircle, LayoutDashboard, BarChart2 } from "lucide-react";
import { format } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Brush } from "recharts";
import { BRUSH_MIN_POINTS, CHART_BAR_FILL_OPACITY } from "../utils/chartDataSampling";
/** Margin for overview bar charts so X-axis category labels have room when angled. */
const OVERVIEW_CHART_MARGIN = { top: 5, right: 5, left: 5, bottom: 72 };
import RichTextEditor from "../components/RichTextEditor";
import { ColorPicker } from "../components/ColorPicker";
import { TradeChart } from "../components/TradeChart";
import { saveAllScrollPositions, restoreAllScrollPositions } from "../utils/scrollManager";
import { DataMode, getCurrentDataMode, subscribeToDataMode } from "../utils/dataMode";
import {
  getSandboxStrategies,
  addSandboxStrategy,
  updateSandboxStrategy,
  deleteSandboxStrategy,
  updateSandboxTradeStrategy,
  loadSandboxState,
  getSandboxStrategyChecklist,
  getSandboxStrategySurveyMetricsWithValues,
  getSandboxStrategyChecklistItemMetrics,
  getSandboxStrategyChecklistItemMetricsByOutcome,
  getSandboxCustomSurveyMetrics,
} from "../utils/sandboxStore";
import { buildPositionGroupsAndPairs, filterPairsByStrategy } from "../utils/sandboxPairing";
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

type TabType = "notes" | "trades" | "checklists" | "survey" | "surveys";

interface ChecklistItem {
  id: number;
  strategy_id: number;
  item_text: string;
  is_checked: boolean;
  item_order: number;
  checklist_type: string;
  parent_id: number | null;
  /** For survey items: true = high (5) is good, false = low (1) is good. Mirrors emotional survey. */
  high_is_good?: boolean | null;
}

/** Checklist item metrics by outcome (winning/losing, checked/not checked) for overview insights. */
interface ChecklistItemMetricByOutcomeRow {
  checklist_item_id: number;
  item_text: string;
  checklist_type: string;
  times_checked_good: number;
  times_checked_bad: number;
  times_not_checked_bad: number;
}

/** Placeholder item text used to persist empty custom checklist types. Filtered out when displaying. */
const EMPTY_CUSTOM_CHECKLIST_PLACEHOLDER = "__empty_custom_checklist_placeholder__";

/** Gradient presets for metric color scale: [position 0–1, hex]. */
const METRIC_COLOR_GRADIENTS: Record<string, [number, string][]> = {
  ryg: [[0, "#ef4444"], [0.5, "#eab308"], [1, "#22c55e"]],
  gyr: [[0, "#22c55e"], [0.5, "#eab308"], [1, "#ef4444"]],
  bluegreen: [[0, "#3b82f6"], [1, "#22c55e"]],
  purplepink: [[0, "#a855f7"], [1, "#ec4899"]],
  cool: [[0, "#0ea5e9"], [0.5, "#06b6d4"], [1, "#22c55e"]],
  warm: [[0, "#ef4444"], [0.5, "#f97316"], [1, "#eab308"]],
  rwg: [[0, "#ef4444"], [0.5, "#fef3c7"], [1, "#22c55e"]],
  viridis: [[0, "#440154"], [0.35, "#3b528b"], [0.65, "#21918c"], [1, "#fde725"]],
  ocean: [[0, "#0c4a6e"], [0.5, "#0e7490"], [1, "#5eead4"]],
  sunset: [[0, "#f97316"], [0.5, "#ec4899"], [1, "#7c3aed"]],
  teal: [[0, "#134e4a"], [0.5, "#0d9488"], [1, "#99f6e4"]],
  amber: [[0, "#78350f"], [0.5, "#d97706"], [1, "#fef08a"]],
  slate: [[0, "#1e293b"], [0.5, "#64748b"], [1, "#cbd5e1"]],
  plum: [[0, "#581c87"], [0.5, "#a855f7"], [1, "#e9d5ff"]],
  fire: [[0, "#7f1d1d"], [0.4, "#dc2626"], [0.7, "#f59e0b"], [1, "#fef3c7"]],
};
const METRIC_COLOR_PRESET_LABELS: Record<string, string> = {
  ryg: "Red → Yellow → Green",
  gyr: "Green → Yellow → Red",
  bluegreen: "Blue → Green",
  purplepink: "Purple → Pink",
  cool: "Blue → Cyan → Green",
  warm: "Red → Orange → Yellow",
  rwg: "Red → White → Green",
  viridis: "Viridis",
  ocean: "Ocean",
  sunset: "Sunset",
  teal: "Teal",
  amber: "Amber",
  slate: "Slate",
  plum: "Plum",
  fire: "Fire",
};

/** Format checklist item avg performance for display (R, %, or $ with 2 decimals). */
function formatChecklistAvgPerformance(avg: number | null, kind: string): string {
  if (avg == null || kind === "none") return "—";
  if (kind === "r") return avg.toFixed(2) + " R";
  if (kind === "pct") return avg.toFixed(1) + "%";
  return "$" + avg.toFixed(2);
}

/** Build CSS linear-gradient string from gradient stops for preview. */
function metricGradientCss(presetKey: string): string {
  const stops = METRIC_COLOR_GRADIENTS[presetKey];
  if (!stops || stops.length === 0) return "linear-gradient(to right, #888, #ccc)";
  const parts = stops.map(([p, hex]) => `${hex} ${Math.round(p * 100)}%`).join(", ");
  return `linear-gradient(to right, ${parts})`;
}

function getMetricColorFromScale(pct01: number, colorScaleJson: string | null | undefined): string {
  const pct = Math.max(0, Math.min(1, Number(pct01) || 0));
  try {
    if (!colorScaleJson || !colorScaleJson.trim()) {
      const stops = METRIC_COLOR_GRADIENTS.ryg;
      const [a, b, t] = interpolateStops(stops, pct);
      return a && b ? lerpHex(a, b, t) : "var(--accent)";
    }
    const data = JSON.parse(colorScaleJson) as { type?: string; preset?: string; hex?: string };
    if (data.type === "static" && data.hex) return data.hex;
    if (data.type === "gradient" && data.preset && METRIC_COLOR_GRADIENTS[data.preset]) {
      const stops = METRIC_COLOR_GRADIENTS[data.preset];
      const [a, b, t] = interpolateStops(stops, pct);
      return a && b ? lerpHex(a, b, t) : "var(--accent)";
    }
  } catch {
    // ignore
  }
  const stops = METRIC_COLOR_GRADIENTS.ryg;
  const [a, b, t] = interpolateStops(stops, pct);
  return a && b ? lerpHex(a, b, t) : "var(--accent)";
}
function interpolateStops(stops: [number, string][], pct: number): [string | null, string | null, number] {
  if (stops.length === 0) return [null, null, 0];
  if (stops.length === 1) return [stops[0][1], stops[0][1], 0];
  for (let i = 0; i < stops.length - 1; i++) {
    const [p0, c0] = stops[i];
    const [p1, c1] = stops[i + 1];
    if (pct <= p1) {
      const t = p0 === p1 ? 1 : (pct - p0) / (p1 - p0);
      return [c0, c1, Math.max(0, Math.min(1, t))];
    }
  }
  const [_, c1] = stops[stops.length - 1];
  return [c1, c1, 0];
}
function lerpHex(a: string, b: string, t: number): string {
  const r1 = parseInt(a.slice(1, 3), 16), g1 = parseInt(a.slice(3, 5), 16), b1 = parseInt(a.slice(5, 7), 16);
  const r2 = parseInt(b.slice(1, 3), 16), g2 = parseInt(b.slice(3, 5), 16), b2 = parseInt(b.slice(5, 7), 16);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const bl = Math.round(b1 + (b2 - b1) * t);
  return "#" + [r, g, bl].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// Sortable Strategy Component
function SortableStrategy({
  strategy,
  isSelected,
  selectedStrategy,
  strategyStats,
  expandedStats,
  setExpandedStats,
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
  saveAllScrollPositions: (tabPositions: Map<TabType, number>, leftScroll: number | null, rightScroll: number | null, page: string) => void;
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

    // Save scroll position before switching
    saveAllScrollPositions(
      tabScrollPositions.current,
      leftPanelScrollRef.current?.scrollTop ?? null,
      rightPanelScrollRef.current?.scrollTop ?? null,
      "strategies"
    );

    // Clicking an already-selected strategy toggles it off
    if (selectedStrategy === strategy.id) {
      clearWorkInProgress();
      setSelectedStrategy(null);
      setIsEditing(false);
      setIsCreating(false);
      return;
    }

    // Selecting a different strategy
    clearWorkInProgress(); // Clear work in progress when selecting an existing strategy
    setSelectedStrategy(strategy.id!);
    setActiveTab("notes");
    setIsEditing(false);
    setIsCreating(false);
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

/** @internal Reserved for optional sortable list UI */
export function SortableStrategyItemUnused({
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

/** Wraps a checklist section so the whole section can be reordered (drag to move above/below other sections including defaults). */
function SortableChecklistSection({
  type,
  isEditing,
  children,
}: {
  type: string;
  isEditing: boolean;
  children: React.ReactNode;
}) {
  const {
    setNodeRef,
    transform,
    transition,
    isDragging,
    attributes,
    listeners,
  } = useSortable({ id: `section:${type}` });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style}>
      {isEditing && (
        <div
          {...attributes}
          {...listeners}
          style={{
            padding: "4px 0",
            marginBottom: "8px",
            cursor: "grab",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "13px",
            color: "var(--text-secondary)",
          }}
        >
          <GripVertical size={16} />
          <span>Drag to reorder checklist</span>
        </div>
      )}
      {children}
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
  useParentDndContext = false,
  onEditTitle,
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
  addChecklistItem: (strategyId: number, type: string, text: string, parentId?: number | null, highIsGood?: boolean) => Promise<void>;
  setPendingGroupAction: Dispatch<SetStateAction<{ strategyId: number; type: string; itemIds: number[] } | null>>;
  setGroupName: Dispatch<SetStateAction<string>>;
  setShowGroupModal: Dispatch<SetStateAction<boolean>>;
  ungroupChecklistItems: (itemIds: number[]) => Promise<void>;
  isCustom: boolean;
  onDeleteChecklist?: () => void;
  moveItemsToGroup: (itemIds: number[], groupId: number, checklistType: string) => Promise<void>;
  /** When true, do not wrap in DndContext (parent provides one for section + item reorder). */
  useParentDndContext?: boolean;
  /** When provided and isEditing, show an edit control to change the section title (readonly by default to avoid drag conflicts). */
  onEditTitle?: (type: string, newTitle: string) => void;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState("");
  const [surveyHighIsGood, setSurveyHighIsGood] = useState(true);
  // Deduplicate by id (first occurrence wins), then hide internal placeholders (used in DB for empty custom checklist types)
  const dedupedById = (() => {
    const byId = new Map<number, ChecklistItem>();
    for (const item of items) {
      if (!byId.has(item.id)) byId.set(item.id, item);
    }
    return Array.from(byId.values());
  })();
  const visibleItems = dedupedById.filter((item) => item.item_text !== EMPTY_CUSTOM_CHECKLIST_PLACEHOLDER);
  const sortedItems = [...visibleItems].sort((a, b) => a.item_order - b.item_order);
  
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
  
  const itemIds = sortedItems.map((item) => item.id);
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
  
  const startEditingTitle = () => {
    setEditTitleValue(title);
    setEditingTitle(true);
  };
  const saveTitle = () => {
    if (onEditTitle) onEditTitle(type, editTitleValue.trim());
    setEditingTitle(false);
  };

  return (
    <div style={{ marginBottom: "40px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px", paddingBottom: "12px", borderBottom: "2px solid var(--border-color)" }}>
        <h4 style={{ fontSize: "18px", fontWeight: "700", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", flex: 1, minWidth: 0 }}>
          <ListChecks size={18} style={{ color: "var(--accent)", flexShrink: 0 }} />
          {editingTitle && onEditTitle ? (
            <>
              <input
                type="text"
                value={editTitleValue}
                onChange={(e) => setEditTitleValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveTitle();
                  if (e.key === "Escape") { setEditingTitle(false); setEditTitleValue(title); }
                }}
                onBlur={saveTitle}
                autoFocus
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: "4px 8px",
                  fontSize: "18px",
                  fontWeight: "700",
                  background: "var(--bg-primary)",
                  border: "1px solid var(--accent)",
                  borderRadius: "6px",
                  color: "var(--text-primary)",
                  outline: "none",
                }}
              />
            </>
          ) : (
            <>
              <span style={{ flex: 1, minWidth: 0 }}>{title}</span>
              {isEditing && onEditTitle && (
                <button
                  type="button"
                  onClick={startEditingTitle}
                  title="Edit checklist title"
                  style={{ background: "none", border: "none", padding: "4px", cursor: "pointer", color: "var(--text-secondary)", display: "flex" }}
                >
                  <Edit2 size={16} />
                </button>
              )}
            </>
          )}
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
        useParentDndContext ? (
          <SortableContext id={`checklist-items-${type}`} items={itemIds} strategy={verticalListSortingStrategy}>
            {allTopLevelItems.map((item) => {
              const isGroup = groups.some(g => g.id === item.id);
              const children = isGroup ? (itemsByParent.get(item.id) || []) : [];
              if (isGroup) {
                return (
                  <div key={item.id} style={{ marginBottom: "20px", position: "relative" }}>
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
                    {children.length > 0 && (
                      <div style={{ position: "relative", marginLeft: "20px", paddingLeft: "24px", borderLeft: "2px solid var(--accent)", opacity: 0.6 }}>
                        {children.map((child, index) => (
                          <div key={child.id} style={{ position: "relative" }}>
                            {index < children.length - 1 && (
                              <div style={{ position: "absolute", left: "-26px", top: "24px", width: "2px", height: "calc(100% + 8px)", backgroundColor: "var(--accent)", opacity: 0.4 }} />
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
                              isGroup={false}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              }
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
                  isGroup={false}
                />
              );
            })}
          </SortableContext>
        ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={(e) => onDragEnd(type, e)}
        >
          <SortableContext id={`checklist-items-${type}`} items={itemIds} strategy={verticalListSortingStrategy}>
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
        )
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
                  addChecklistItem(selectedStrategy, type, currentValue, null, type === "survey" ? surveyHighIsGood : undefined);
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
            {type === "survey" && (
              <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                <span style={{ fontSize: "12px", color: "var(--text-secondary)", fontWeight: "500" }}>Scale:</span>
                <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "12px", color: "var(--text-primary)" }}>
                  <input type="radio" name={`survey-high-${type}`} checked={surveyHighIsGood === true} onChange={() => setSurveyHighIsGood(true)} />
                  High is good (e.g. 5 = desirable)
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "12px", color: "var(--text-primary)" }}>
                  <input type="radio" name={`survey-high-${type}`} checked={surveyHighIsGood === false} onChange={() => setSurveyHighIsGood(false)} />
                  Low is good (e.g. 1 = desirable)
                </label>
              </div>
            )}
            <button
              onClick={() => addChecklistItem(selectedStrategy, type, currentValue, null, type === "survey" ? surveyHighIsGood : undefined)}
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
  const [dataMode, setDataMode] = useState<DataMode>(() => getCurrentDataMode());
  const [loading, setLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    const unsub = subscribeToDataMode(setDataMode);
    return () => unsub();
  }, []);
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
  const [strategyOverviewTab, setStrategyOverviewTab] = useState<"pnl" | "win_rate" | "trades" | "checklist_usage" | "profitable_trades">("pnl");
  const [strategyOverviewBrushStart, setStrategyOverviewBrushStart] = useState(0);
  const [strategyOverviewBrushEnd, setStrategyOverviewBrushEnd] = useState(0);
  const [strategyFilterText, setStrategyFilterText] = useState("");
  const [strategyOverviewOnlyWithTrades, setStrategyOverviewOnlyWithTrades] = useState(false);
  /** When non-empty, overview stats/chart show only these strategies. Empty = all strategies. */
  const [overviewFilterStrategyIds, setOverviewFilterStrategyIds] = useState<number[]>([]);
  const [overviewFilterDropdownOpen, setOverviewFilterDropdownOpen] = useState(false);
  const overviewFilterDropdownRef = useRef<HTMLDivElement>(null);
  /** Custom metrics with values per strategy, loaded when overview is visible. */
  const [overviewChecklistItemMetricsByStrategy, setOverviewChecklistItemMetricsByStrategy] = useState<Map<number, Array<{ checklist_item_id: number; item_text: string; checklist_type: string; times_checked: number; avg_performance: number | null; performance_kind: string }>>>(new Map());
  const [overviewCustomMetricsByStrategy, setOverviewCustomMetricsByStrategy] = useState<Map<number, Array<{
    id: number; name: string; description: string | null; formula_type: string; computed_value: number | null; color_scale?: string | null;
  }>>>(new Map());
  /** Per-strategy checklist by outcome for overview: top winning items + often not clicked in losing trades. */
  const [overviewChecklistByOutcomePerStrategy, setOverviewChecklistByOutcomePerStrategy] = useState<Array<{ strategyId: number; strategyName: string; items: ChecklistItemMetricByOutcomeRow[] }>>([]);

  // Sensors for strategy drag-and-drop
  const strategySensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
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
  const [showAddSurveyModal, setShowAddSurveyModal] = useState(false);
  const [newSurveyName, setNewSurveyName] = useState("");
  /** When true, newly created checklists are inserted at the top (after default types); when false, appended at the bottom. */
  const [newChecklistAtTop, setNewChecklistAtTop] = useState(true);
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
  const [markImportedTradesAsPaper, setMarkImportedTradesAsPaper] = useState(false);
  const [pendingCSVFile, setPendingCSVFile] = useState<{ path: string; isForExisting: boolean } | null>(null);
  const [pendingCSVFiles, setPendingCSVFiles] = useState<{ path: string; isForExisting: boolean }[]>([]);
  const [importResults, setImportResults] = useState<{
    totalAttempted: number;
    newTrades: number;
    duplicates: number;
    errors: number;
  } | null>(null);
  const [customSurveyMetrics, setCustomSurveyMetrics] = useState<Array<{ checklist_item_id: number; item_text: string; response_count: number; avg_value: number | null }>>([]);
  /** Outcome-based insight items for the selected strategy (used on Surveys tab for Survey Insights). */
  const [selectedStrategySurveyInsightItems, setSelectedStrategySurveyInsightItems] = useState<ChecklistItemMetricByOutcomeRow[]>([]);
  const [customSurveyMetricDefinitions, setCustomSurveyMetricDefinitions] = useState<Array<{
    id: number; strategy_id: number; name: string; description: string | null; formula_type: string; item_ids: string; display_order: number; computed_value: number | null; color_scale: string | null;
  }>>([]);
  const [calculationPresets, setCalculationPresets] = useState<Array<{ id: number; strategy_id: number; name: string; formula_type: string; formula_expression?: string | null; display_order: number }>>([]);
  /** When creating a strategy, presets are held here until save. */
  const [tempCalculationPresets, setTempCalculationPresets] = useState<Array<{ name: string; formula_expression: string; display_order: number }>>([]);
  /** When creating a strategy, metrics are held here until save. item_ids are temp checklist item ids. */
  const [tempSurveyMetrics, setTempSurveyMetrics] = useState<Array<{
    name: string; description: string | null; formula_type: string; item_ids: number[]; display_order: number; color_scale: string | null;
  }>>([]);
  const [presetModal, setPresetModal] = useState<null | "add" | number>(null);
  const [presetForm, setPresetForm] = useState<{ name: string; formula_expression: string }>({ name: "", formula_expression: "" });
  /** When true, preset modal was opened from Add/Edit metric; after saving new preset we select it in the metric form. */
  const [openPresetFromMetricModal, setOpenPresetFromMetricModal] = useState(false);
  const [surveyMetricModal, setSurveyMetricModal] = useState<null | "add" | number>(null);
  const [colorPresetDropdownOpen, setColorPresetDropdownOpen] = useState(false);
  /** Checklist/survey item metrics: when checked, avg performance (R → % → price). */
  const [checklistItemMetrics, setChecklistItemMetrics] = useState<Array<{ checklist_item_id: number; item_text: string; checklist_type: string; times_checked: number; avg_performance: number | null; performance_kind: string }>>([]);
  const [surveyMetricForm, setSurveyMetricForm] = useState<{
    name: string;
    description: string;
    formula_type: string;
    item_ids: number[];
    color_scale_type: "gradient" | "static";
    color_scale_preset: string;
    color_scale_static: string;
  }>({
    name: "",
    description: "",
    formula_type: "avg",
    item_ids: [],
    color_scale_type: "gradient",
    color_scale_preset: "ryg",
    color_scale_static: "#3b82f6",
  });
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
    isPaperTrade: false,
  });
  const [isAddingTrade, setIsAddingTrade] = useState(false);
  const [addTradeError, setAddTradeError] = useState<string | null>(null);
  /** Strategy to assign the new trade to: captured when user opens Add Trade from Strategies tab (so it auto-assigns to the currently selected strategy). */
  const addTradeStrategyIdRef = useRef<number | null>(null);
  const [selectedPairForChart, setSelectedPairForChart] = useState<PairedTrade | null>(null);

  // When opening Add Trade modal, default "Flag as paper trade" from current data mode
  useEffect(() => {
    if (showAddTradeModal && dataMode !== "sandbox") {
      setAddTradeForm((f) => ({ ...f, isPaperTrade: dataMode === "paper" }));
    }
  }, [showAddTradeModal, dataMode]);

  // When opening CSV format modal, default "Mark as paper" from current data mode
  useEffect(() => {
    if (showCSVFormatModal && dataMode !== "sandbox") {
      setMarkImportedTradesAsPaper(dataMode === "paper");
    }
  }, [showCSVFormatModal, dataMode]);
  const [editHistory, setEditHistory] = useState<Array<{ name: string; description: string; color: string; notes: string }>>([]);
  const [editingChecklists, setEditingChecklists] = useState<Map<number, Map<string, ChecklistItem[]>>>(new Map());
  const [originalChecklists, setOriginalChecklists] = useState<Map<number, Map<string, ChecklistItem[]>>>(new Map());
  const [checklistEditHistory, setChecklistEditHistory] = useState<Map<number, Array<Map<string, ChecklistItem[]>>>>(new Map());
  
  // Checklist type display order per strategy (allows custom checklists above Analysis, Mantra, Entry, Take Profit). Persisted in localStorage.
  const CHECKLIST_TYPE_ORDER_KEY = "tradebutler_checklist_type_order";
  const [checklistTypeOrder, setChecklistTypeOrder] = useState<Map<number, string[]>>(() => {
    try {
      const saved = localStorage.getItem(CHECKLIST_TYPE_ORDER_KEY);
      if (!saved) return new Map();
      const parsed = JSON.parse(saved) as Record<string, string[]>;
      return new Map(Object.entries(parsed).map(([k, v]) => [parseInt(k, 10), v]));
    } catch {
      return new Map();
    }
  });
  
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

  // Save scroll positions using utility (available for programmatic save)
  const saveScrollPositionsForStrategies = () => {
    saveAllScrollPositions(
      tabScrollPositions.current,
      leftPanelScrollRef.current?.scrollTop ?? null,
      rightPanelScrollRef.current?.scrollTop ?? null,
      "strategies"
    );
  };
  void saveScrollPositionsForStrategies;

  // Restore scroll positions using utility
  const restoreScrollPositions = () => {
    const scrollState = restoreAllScrollPositions("strategies");
    
    // Restore tab scroll positions to the ref
    scrollState.tabPositions.forEach((pos, tab) => {
      tabScrollPositions.current.set(tab as TabType, pos);
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

  useEffect(() => {
    if (checklistTypeOrder.size === 0) return;
    const obj: Record<string, string[]> = {};
    checklistTypeOrder.forEach((order, strategyId) => {
      obj[String(strategyId)] = order;
    });
    localStorage.setItem(CHECKLIST_TYPE_ORDER_KEY, JSON.stringify(obj));
  }, [checklistTypeOrder]);

  const CHECKLIST_TITLES_KEY = "tradebutler_checklist_titles";
  const [checklistTitles, setChecklistTitles] = useState<Map<number, Map<string, string>>>(() => {
    try {
      const raw = localStorage.getItem(CHECKLIST_TITLES_KEY);
      if (!raw) return new Map();
      const parsed = JSON.parse(raw) as Record<string, Record<string, string>>;
      const map = new Map<number, Map<string, string>>();
      Object.entries(parsed).forEach(([k, v]) => {
        map.set(parseInt(k, 10), new Map(Object.entries(v)));
      });
      return map;
    } catch {
      return new Map();
    }
  });
  useEffect(() => {
    if (checklistTitles.size === 0) return;
    const obj: Record<string, Record<string, string>> = {};
    checklistTitles.forEach((titles, strategyId) => {
      obj[String(strategyId)] = Object.fromEntries(titles);
    });
    localStorage.setItem(CHECKLIST_TITLES_KEY, JSON.stringify(obj));
  }, [checklistTitles]);

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
  }, [dataMode]);

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

  useEffect(() => {
    if ((activeTab === "survey" || activeTab === "surveys") && selectedStrategy != null && !isCreating) {
      if (dataMode === "sandbox") {
        const raw = getSandboxCustomSurveyMetrics(selectedStrategy);
        const defs = getSandboxStrategySurveyMetricsWithValues(selectedStrategy) as unknown as Array<{ id: number; strategy_id: number; name: string; description: string | null; formula_type: string; item_ids: string; display_order: number; computed_value: number | null; color_scale: string | null }>;
        const itemMetrics = getSandboxStrategyChecklistItemMetrics(selectedStrategy);
        setCustomSurveyMetrics(raw);
        setCustomSurveyMetricDefinitions(defs);
        setCalculationPresets([]);
        setChecklistItemMetrics(itemMetrics);
      } else {
        Promise.all([
          invoke<Array<{ checklist_item_id: number; item_text: string; response_count: number; avg_value: number | null }>>("get_custom_survey_metrics", { strategyId: selectedStrategy }),
          invoke<Array<{ id: number; strategy_id: number; name: string; description: string | null; formula_type: string; item_ids: string; display_order: number; computed_value: number | null; color_scale: string | null }>>("get_strategy_survey_metrics_with_values", { strategyId: selectedStrategy }),
          invoke<Array<{ id: number; strategy_id: number; name: string; formula_type: string; formula_expression?: string | null; display_order: number }>>("get_strategy_calculation_presets", { strategyId: selectedStrategy }),
          invoke<Array<{ checklist_item_id: number; item_text: string; checklist_type: string; times_checked: number; avg_performance: number | null; performance_kind: string }>>("get_strategy_checklist_item_metrics", { strategyId: selectedStrategy }),
        ])
          .then(([raw, defs, presets, itemMetrics]) => {
            setCustomSurveyMetrics(raw);
            setCustomSurveyMetricDefinitions(defs);
            setCalculationPresets(presets);
            setChecklistItemMetrics(itemMetrics);
          })
          .catch(() => {
            setCustomSurveyMetrics([]);
            setCustomSurveyMetricDefinitions([]);
            setCalculationPresets([]);
            setChecklistItemMetrics([]);
          });
      }
    } else {
      setCustomSurveyMetrics([]);
      setCustomSurveyMetricDefinitions([]);
      setCalculationPresets([]);
      setChecklistItemMetrics([]);
    }
  }, [activeTab, selectedStrategy, isCreating, dataMode]);

  // Load custom metrics, checklist item metrics, and checklist-by-outcome for all strategies when overview is visible (no strategy selected)
  useEffect(() => {
    if (selectedStrategy != null || isCreating || strategies.length === 0) {
      setOverviewCustomMetricsByStrategy(new Map());
      setOverviewChecklistItemMetricsByStrategy(new Map());
      setOverviewChecklistByOutcomePerStrategy([]);
      return;
    }
    const load = async () => {
      const next = new Map<number, Array<{ id: number; name: string; description: string | null; formula_type: string; computed_value: number | null; color_scale?: string | null }>>();
      const nextItemMetrics = new Map<number, Array<{ checklist_item_id: number; item_text: string; checklist_type: string; times_checked: number; avg_performance: number | null; performance_kind: string }>>();
      const byOutcome: Array<{ strategyId: number; strategyName: string; items: ChecklistItemMetricByOutcomeRow[] }> = [];
      if (dataMode === "sandbox") {
        for (const s of strategies) {
          if (s.id == null) continue;
          const defs = getSandboxStrategySurveyMetricsWithValues(s.id) as unknown as Array<{ id: number; name: string; description: string | null; formula_type: string; computed_value: number | null; color_scale: string | null }>;
          const itemMetrics = getSandboxStrategyChecklistItemMetrics(s.id);
          const outcomeItems = getSandboxStrategyChecklistItemMetricsByOutcome(s.id) as ChecklistItemMetricByOutcomeRow[];
          if (defs.length > 0) next.set(s.id, defs);
          if (itemMetrics.length > 0) nextItemMetrics.set(s.id, itemMetrics);
          if (outcomeItems.length > 0) byOutcome.push({ strategyId: s.id, strategyName: s.name, items: outcomeItems });
        }
        setOverviewCustomMetricsByStrategy(next);
        setOverviewChecklistItemMetricsByStrategy(nextItemMetrics);
        setOverviewChecklistByOutcomePerStrategy(byOutcome);
        return;
      }
      for (const s of strategies) {
        if (s.id == null) continue;
        try {
          const [defs, itemMetrics, outcomeItems] = await Promise.all([
            invoke<Array<{ id: number; name: string; description: string | null; formula_type: string; computed_value: number | null; color_scale: string | null }>>("get_strategy_survey_metrics_with_values", { strategyId: s.id }),
            invoke<Array<{ checklist_item_id: number; item_text: string; checklist_type: string; times_checked: number; avg_performance: number | null; performance_kind: string }>>("get_strategy_checklist_item_metrics", { strategyId: s.id }),
            invoke<ChecklistItemMetricByOutcomeRow[]>("get_strategy_checklist_item_metrics_by_outcome", { strategyId: s.id }).catch(() => []),
          ]);
          if (defs.length > 0) next.set(s.id, defs);
          if (itemMetrics.length > 0) nextItemMetrics.set(s.id, itemMetrics);
          if (outcomeItems.length > 0) byOutcome.push({ strategyId: s.id, strategyName: s.name, items: outcomeItems });
        } catch {
          // ignore
        }
      }
      setOverviewCustomMetricsByStrategy(next);
      setOverviewChecklistItemMetricsByStrategy(nextItemMetrics);
      setOverviewChecklistByOutcomePerStrategy(byOutcome);
    };
    load();
  }, [strategies, selectedStrategy, isCreating, dataMode]);

  // Load outcome items for selected strategy (for Survey Insights on Surveys tab)
  useEffect(() => {
    if (selectedStrategy == null || isCreating) {
      setSelectedStrategySurveyInsightItems([]);
      return;
    }
    if (dataMode === "sandbox") {
      const items = getSandboxStrategyChecklistItemMetricsByOutcome(selectedStrategy) as ChecklistItemMetricByOutcomeRow[];
      setSelectedStrategySurveyInsightItems(items);
      return;
    }
    invoke<ChecklistItemMetricByOutcomeRow[]>("get_strategy_checklist_item_metrics_by_outcome", { strategyId: selectedStrategy })
      .then(setSelectedStrategySurveyInsightItems)
      .catch(() => setSelectedStrategySurveyInsightItems([]));
  }, [selectedStrategy, isCreating, dataMode]);

  useEffect(() => {
    if (!overviewFilterDropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (overviewFilterDropdownRef.current && !overviewFilterDropdownRef.current.contains(e.target as Node)) {
        setOverviewFilterDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [overviewFilterDropdownOpen]);

  const calculateStrategyStats = (pairs: PairedTrade[]) => {
    const totalTrades = pairs.length;
    const totalPnL = pairs.reduce((sum, pair) => sum + pair.net_profit_loss, 0);
    const winningTrades = pairs.filter(pair => pair.net_profit_loss > 0).length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    return { totalTrades, totalPnL, winRate };
  };

  const loadStrategyStats = async (strategyId: number) => {
    try {
      if (dataMode === "sandbox") {
        const state = loadSandboxState();
        const pairingMethod = (localStorage.getItem("tradebutler_pairing_method") || "FIFO") as "FIFO" | "LIFO";
        const { pairs } = buildPositionGroupsAndPairs(
          state.trades.map((t) => ({
            id: t.id,
            symbol: t.symbol,
            side: t.side,
            quantity: t.quantity,
            price: t.price,
            timestamp: t.timestamp,
            fees: t.fees,
            notes: t.notes,
            strategy_id: t.strategy_id,
          })),
          pairingMethod
        );
        const tradeById = new Map(state.trades.map((t) => [t.id, t]));
        const strategyPairs = filterPairsByStrategy(pairs, tradeById, strategyId);
        const stats = calculateStrategyStats(strategyPairs as unknown as PairedTrade[]);
        setStrategyStats(new Map(strategyStats.set(strategyId, stats)));
        return;
      }
      const pairingMethod = localStorage.getItem("tradebutler_pairing_method") || "FIFO";
      const paperArgs = dataMode === "paper" ? { paperOnly: true } : {};
      const pairs = await invoke<PairedTrade[]>("get_paired_trades_by_strategy", {
        strategyId: strategyId,
        pairingMethod: pairingMethod,
        startDate: null,
        endDate: null,
        ...paperArgs,
      });
      const stats = calculateStrategyStats(pairs);
      setStrategyStats(new Map(strategyStats.set(strategyId, stats)));
    } catch (error) {
      console.error("Error loading strategy stats:", error);
    }
  };

  const filteredStrategies = React.useMemo(() => {
    let list = strategies;
    if (overviewFilterStrategyIds.length > 0) {
      const idSet = new Set(overviewFilterStrategyIds);
      list = list.filter((s) => s.id != null && idSet.has(s.id));
    }
    const text = strategyFilterText.trim().toLowerCase();
    return list.filter((s) => {
      if (strategyOverviewOnlyWithTrades) {
        const stats = s.id != null ? strategyStats.get(s.id) : undefined;
        if (!stats || stats.totalTrades <= 0) return false;
      }
      if (!text) return true;
      const name = s.name.toLowerCase();
      const desc = (s.description || "").toLowerCase();
      return name.includes(text) || desc.includes(text);
    });
  }, [strategies, overviewFilterStrategyIds, strategyFilterText, strategyOverviewOnlyWithTrades, strategyStats]);

  // Sort strategies based on order
  const sortedStrategies = React.useMemo(() => {
    if (strategyOrder.length === 0) {
      return filteredStrategies;
    }
    
    const ordered = [...filteredStrategies].sort((a, b) => {
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
  }, [filteredStrategies, strategyOrder]);

  const strategiesForOverview = filteredStrategies;
  const strategiesOverviewStats = React.useMemo(() => {
    let totalStrategies = strategiesForOverview.length;
    let withTrades = 0;
    let totalPnL = 0;
    let bestWinRateName: string | null = null;
    let bestWinRate = 0;

    for (const s of strategiesForOverview) {
      if (s.id == null) continue;
      const stats = strategyStats.get(s.id);
      if (!stats) continue;
      if (stats.totalTrades > 0) {
        withTrades += 1;
        totalPnL += stats.totalPnL;
        if (stats.winRate > bestWinRate) {
          bestWinRate = stats.winRate;
          bestWinRateName = s.name;
        }
      }
    }

    return {
      totalStrategies,
      withTrades,
      totalPnL,
      bestWinRate,
      bestWinRateName,
    };
  }, [strategiesForOverview, strategyStats]);

  const strategiesOverviewChartData = React.useMemo(() => {
    const data: { name: string; fullName: string; pnl: number; win_rate: number; trades: number }[] = [];
    for (const s of strategiesForOverview) {
      if (s.id == null) continue;
      const stats = strategyStats.get(s.id);
      if (!stats || stats.totalTrades <= 0) continue;
      const shortName = s.name.length > 14 ? s.name.slice(0, 13) + "…" : s.name;
      data.push({
        name: shortName,
        fullName: s.name,
        pnl: Number(stats.totalPnL.toFixed(2)),
        win_rate: Number(stats.winRate.toFixed(1)),
        trades: stats.totalTrades,
      });
    }
    return data.sort((a, b) => {
      if (strategyOverviewTab === "pnl") return Math.abs(b.pnl) - Math.abs(a.pnl);
      if (strategyOverviewTab === "win_rate") return b.win_rate - a.win_rate;
      if (strategyOverviewTab === "trades") return b.trades - a.trades;
      return b.trades - a.trades;
    });
  }, [strategiesForOverview, strategyStats, strategyOverviewTab]);

  const overviewChecklistUsageChartData = React.useMemo(() => {
    const byType = new Map<string, number>();
    overviewChecklistItemMetricsByStrategy.forEach((rows) => {
      rows.forEach((row) => {
        const type = row.checklist_type || "other";
        byType.set(type, (byType.get(type) ?? 0) + (row.times_checked ?? 0));
      });
    });
    return Array.from(byType.entries())
      .map(([checklist_type, count]) => ({
        name: checklist_type.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "),
        count,
      }))
      .sort((a, b) => b.count - a.count);
  }, [overviewChecklistItemMetricsByStrategy]);

  const overviewProfitableTradesChartData = React.useMemo(() => {
    const data: { name: string; fullName: string; winning: number; losing: number }[] = [];
    for (const s of strategiesForOverview) {
      if (s.id == null) continue;
      const stats = strategyStats.get(s.id);
      if (!stats || stats.totalTrades <= 0) continue;
      const shortName = s.name.length > 14 ? s.name.slice(0, 13) + "…" : s.name;
      const winning = Math.round(stats.totalTrades * (stats.winRate / 100));
      const losing = stats.totalTrades - winning;
      data.push({ name: shortName, fullName: s.name, winning, losing });
    }
    return data.sort((a, b) => b.winning + b.losing - (a.winning + a.losing));
  }, [strategiesForOverview, strategyStats]);

  const loadStrategies = async (preserveEditingState = false) => {
    try {
      if (dataMode === "sandbox") {
        const data = getSandboxStrategies().map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          notes: s.notes,
          created_at: s.created_at,
          color: s.color,
          display_order: null as number | null,
        }));
        setStrategies(data);
        const state = loadSandboxState();
        const pairingMethod = (localStorage.getItem("tradebutler_pairing_method") || "FIFO") as "FIFO" | "LIFO";
        const { pairs } = buildPositionGroupsAndPairs(
          state.trades.map((t) => ({
            id: t.id,
            symbol: t.symbol,
            side: t.side,
            quantity: t.quantity,
            price: t.price,
            timestamp: t.timestamp,
            fees: t.fees,
            notes: t.notes,
            strategy_id: t.strategy_id,
          })),
          pairingMethod
        );
        const tradeById = new Map(state.trades.map((t) => [t.id, t]));
        const newStats = new Map<number, { totalTrades: number; totalPnL: number; winRate: number }>();
        for (const s of data) {
          if (s.id == null) continue;
          const strategyPairs = filterPairsByStrategy(pairs, tradeById, s.id);
          newStats.set(s.id, calculateStrategyStats(strategyPairs as unknown as PairedTrade[]));
        }
        setStrategyStats(newStats);
        setLoading(false);
        return;
      }
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
        if (dataMode === "sandbox") {
          const state = loadSandboxState();
          const pairingMethod = (localStorage.getItem("tradebutler_pairing_method") || "FIFO") as "FIFO" | "LIFO";
          const { pairs } = buildPositionGroupsAndPairs(
            state.trades.map((t) => ({
              id: t.id,
              symbol: t.symbol,
              side: t.side,
              quantity: t.quantity,
              price: t.price,
              timestamp: t.timestamp,
              fees: t.fees,
              notes: t.notes,
              strategy_id: t.strategy_id,
            })),
            pairingMethod
          );
          const tradeById = new Map(state.trades.map((t) => [t.id, t]));
          const filtered = filterPairsByStrategy(pairs, tradeById, strategyId);
          setStrategyPairs(new Map(strategyPairs.set(strategyId, filtered as unknown as PairedTrade[])));
          const stats = calculateStrategyStats(filtered as unknown as PairedTrade[]);
          setStrategyStats(new Map(strategyStats.set(strategyId, stats)));
        } else {
          const pairingMethod = localStorage.getItem("tradebutler_pairing_method") || "FIFO";
          const paperArgs = dataMode === "paper" ? { paperOnly: true } : {};
          const pairs = await invoke<PairedTrade[]>("get_paired_trades_by_strategy", {
            strategyId: strategyId,
            pairingMethod: pairingMethod,
            startDate: null,
            endDate: null,
            ...paperArgs,
          });
          setStrategyPairs(new Map(strategyPairs.set(strategyId, pairs)));
          const stats = calculateStrategyStats(pairs);
          setStrategyStats(new Map(strategyStats.set(strategyId, stats)));
        }
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
      let allItems: ChecklistItem[];
      if (dataMode === "sandbox") {
        allItems = getSandboxStrategyChecklist(strategyId) as unknown as ChecklistItem[];
      } else {
        allItems = await invoke<ChecklistItem[]>("get_strategy_checklist", {
          strategyId: strategyId,
          checklistType: null,
        });
      }
      
      // Default checklist types - always include these even if empty
      const defaultTypes = ["daily_analysis", "daily_mantra", "entry", "take_profit"];
      const checklistMap = new Map<string, ChecklistItem[]>();
      const customTypesSet = new Set<string>();
      
      // Placeholder items used to persist empty custom checklist types - filter them out when displaying
      
      // Initialize default types
      for (const type of defaultTypes) {
        checklistMap.set(type, []);
      }
      
      // Group items by type (exclude placeholder items from display, but ensure their type is registered).
      // Deduplicate by item id so the same row is never shown twice (handles duplicate DB rows or double-loads).
      const seenIds = new Set<number>();
      for (const item of allItems) {
        const type = item.checklist_type;
        if (!checklistMap.has(type)) {
          checklistMap.set(type, []);
          if (!defaultTypes.includes(type) && type !== "survey") {
            customTypesSet.add(type);
          }
        }
        if (item.item_text === EMPTY_CUSTOM_CHECKLIST_PLACEHOLDER) continue;
        if (seenIds.has(item.id)) continue;
        seenIds.add(item.id);
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
      checklistMap.set("daily_analysis", []);
      checklistMap.set("daily_mantra", []);
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

  /** Inserts a new checklist type into a map at top (first) or bottom (last) of iteration order. */
  const addChecklistTypeToMap = (map: Map<string, ChecklistItem[]>, typeName: string, atTop: boolean): Map<string, ChecklistItem[]> => {
    if (map.has(typeName)) return new Map(map);
    if (atTop) {
      const next = new Map<string, ChecklistItem[]>();
      next.set(typeName, []);
      for (const [k, v] of map.entries()) next.set(k, v);
      return next;
    }
    const next = new Map(map);
    next.set(typeName, []);
    return next;
  };

  const addChecklistItem = async (strategyId: number, type: string, text: string, parentId: number | null = null, highIsGood?: boolean) => {
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
        ...(type === "survey" && { high_is_good: highIsGood ?? true }),
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
        ...(type === "survey" && { high_is_good: highIsGood ?? true }),
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
        high_is_good: type === "survey" ? (highIsGood ?? true) : undefined,
      });

      const newItem: ChecklistItem = {
        id: newId,
        strategy_id: strategyId,
        item_text: text.trim(),
        is_checked: false,
        item_order: itemOrder,
        checklist_type: type,
        parent_id: parentId,
        ...(type === "survey" && { high_is_good: highIsGood ?? true }),
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
    if (!confirm("Delete this item? This cannot be undone.")) return;
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
    const defaultTypes = ["daily_analysis", "daily_mantra", "entry", "take_profit"];
    if (defaultTypes.includes(type) || type === "survey") {
      if (type === "survey") return; // Post-Trade Survey is not deletable
      alert("Cannot delete default checklist types (Analysis, Mantra, Entry, or Take Profit)");
      return;
    }

    const confirmMsg = type.startsWith("survey_")
      ? `Are you sure you want to delete "${type.replace(/^survey_/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}"? All items in this survey will be removed. This cannot be undone.`
      : `Are you sure you want to delete the "${type.split('_').map((word: string) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')} Checklist"? This will delete all items in this checklist.`;
    if (!confirm(confirmMsg)) {
      return;
    }

    // Creating (virtual -1): only update tempChecklists
    if (strategyId === -1) {
      const updated = new Map(tempChecklists);
      updated.delete(type);
      setTempChecklists(updated);
      setNewChecklistItem((prev) => { const m = new Map(prev); m.delete(type); return m; });
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
            high_is_good: item.checklist_type === "survey" ? (item.high_is_good ?? true) : undefined,
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
          high_is_good: item.checklist_type === "survey" ? (item.high_is_good ?? true) : undefined,
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
          high_is_good: item.checklist_type === "survey" ? (item.high_is_good ?? true) : undefined,
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
          
          const importedTradeIds = await invoke<number[]>("import_trades_csv", { csvData: contents, mark_as_paper: markImportedTradesAsPaper ? true : undefined });
          
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
            const paperArgs = dataMode === "paper" ? { paperOnly: true } : {};
            const pairs = await invoke<PairedTrade[]>("get_paired_trades_by_strategy", {
              strategyId: selectedStrategy,
              pairingMethod: pairingMethod,
              startDate: null,
              endDate: null,
              ...paperArgs,
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
      const baseNotes = addTradeForm.notes.trim();
      const notesWithPaper = addTradeForm.isPaperTrade
        ? `${baseNotes ? baseNotes + " " : ""}[PAPER]`
        : (baseNotes || null);
      const newId = await invoke<number>("add_trade_manual", {
        symbol: addTradeForm.symbol.trim(),
        side: addTradeForm.side,
        quantity: qty,
        price: pr,
        timestamp,
        order_type: addTradeForm.orderType || null,
        fees: feeVal,
        notes: notesWithPaper,
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
        isPaperTrade: dataMode === "paper",
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
            const paperArgs = dataMode === "paper" ? { paperOnly: true } : {};
            const pairs = await invoke<PairedTrade[]>("get_paired_trades_by_strategy", {
              strategyId: assignedStrategyId,
              pairingMethod,
              startDate: null,
              endDate: null,
              ...paperArgs,
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
      let newStrategyId: number;
      if (dataMode === "sandbox") {
        const newStrategy = addSandboxStrategy({
          name: editingFormData.name,
          description: editingFormData.description ?? null,
          notes: newStrategyNotes || null,
          color: editingFormData.color ?? null,
        });
        newStrategyId = newStrategy.id;
        if (pendingTradeIds.length > 0) {
          for (const tradeId of pendingTradeIds) {
            updateSandboxTradeStrategy(tradeId, newStrategyId);
          }
        }
        await loadStrategies();
        setSelectedStrategy(newStrategyId);
        setActiveTab("notes");
        setIsCreating(false);
        setPendingTradeIds([]);
        setTempChecklists(new Map());
        setEditingFormData({ name: "", description: "", color: "#3b82f6" });
        setNewStrategyNotes("");
        return;
      }
      // Create the strategy - returns just the ID
      newStrategyId = await invoke<number>("create_strategy", {
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

      // Save temporary checklist items (preserve parent relationships); idMap used later for temp metrics
      const idMap = new Map<number, number>();
      if (tempChecklists.size > 0) {
        
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
              high_is_good: type === "survey" ? (item.high_is_good ?? true) : undefined,
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
              const newId = await invoke<number>("save_strategy_checklist_item", {
                id: null,
                strategyId: newStrategyId,
                itemText: item.item_text,
                isChecked: item.is_checked,
                itemOrder: item.item_order,
                checklistType: type,
                parentId: newParentId,
                high_is_good: type === "survey" ? (item.high_is_good ?? true) : undefined,
              });
              idMap.set(item.id, newId);
            }
          }
        }

        // Third pass: Persist empty custom checklist types with a placeholder item so they display when viewing
        const defaultTypes = ["daily_analysis", "daily_mantra", "entry", "take_profit"];
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

      // Save temp calculation presets and collect their new ids (for mapping preset:0 → preset:id in metrics)
      const presetIds: number[] = [];
      for (let i = 0; i < tempCalculationPresets.length; i++) {
        const id = await invoke<number>("save_strategy_calculation_preset", {
          id: null,
          strategyId: newStrategyId,
          name: tempCalculationPresets[i].name,
          formulaType: "custom",
          formulaExpression: tempCalculationPresets[i].formula_expression || null,
          displayOrder: i,
        });
        presetIds.push(id);
      }

      // Save temp custom metrics (map temp item_ids to new ids via idMap; map preset:idx to preset:id)
      for (const m of tempSurveyMetrics) {
        const mappedIds = m.item_ids.map((id) => idMap.get(id)).filter((id): id is number => id != null);
        if (mappedIds.length === 0) continue;
        let formulaType = m.formula_type;
        if (formulaType.startsWith("preset:")) {
          const idx = parseInt(formulaType.slice(7), 10);
          if (!Number.isNaN(idx) && presetIds[idx] != null) formulaType = "preset:" + presetIds[idx];
        }
        await invoke("save_strategy_survey_metric", {
          id: null,
          strategyId: newStrategyId,
          name: m.name,
          description: m.description || null,
          formulaType,
          itemIds: JSON.stringify(mappedIds),
          displayOrder: m.display_order,
          colorScale: m.color_scale,
        });
      }

      // Reset and reload
      setIsCreating(false);
      setIsEditing(false); // Ensure we're in view mode, not edit mode
      setNewStrategyNotes("");
      setEditingFormData({ name: "", description: "", color: "#3b82f6" });
      setPendingTradeIds([]);
      setTempChecklists(new Map());
      setTempCalculationPresets([]);
      setTempSurveyMetrics([]);
      setImportResults(null); // Clear any import results
      
      // Clear work-in-progress AFTER setting isCreating to false to prevent restoration
      clearWorkInProgress();
      
      await loadStrategies();
      // Select the newly created strategy
      setSelectedStrategy(newStrategyId);
      // Preserve checklist type order and custom titles from create flow (-1) to the new strategy
      const orderFromCreate = checklistTypeOrder.get(-1);
      if (orderFromCreate && orderFromCreate.length > 0) {
        setChecklistTypeOrder((prev) => {
          const next = new Map(prev);
          next.set(newStrategyId, orderFromCreate);
          next.delete(-1);
          return next;
        });
      }
      const titlesFromCreate = checklistTitles.get(-1);
      if (titlesFromCreate && titlesFromCreate.size > 0) {
        setChecklistTitles((prev) => {
          const next = new Map(prev);
          next.set(newStrategyId, new Map(titlesFromCreate));
          next.delete(-1);
          return next;
        });
      }
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
        const paperArgs = dataMode === "paper" ? { paperOnly: true } : {};
        const pairs = await invoke<PairedTrade[]>("get_paired_trades_by_strategy", {
          strategyId: newStrategyId,
          pairingMethod: pairingMethod,
          startDate: null,
          endDate: null,
          ...paperArgs,
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
    setTempCalculationPresets([]);
    setTempSurveyMetrics([]);
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
            high_is_good: type === "survey" ? (item.high_is_good ?? true) : undefined,
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
            high_is_good: type === "survey" ? (item.high_is_good ?? true) : undefined,
          });
          
          // If it's a new item, map the old temporary ID to the new database ID
          if (isNew) {
            idMap.set(item.id, newId);
          }
        }
      }
    }
    
    // Third pass: Persist empty custom checklist types with a placeholder item so they display when viewing
    const defaultTypes = ["daily_analysis", "daily_mantra", "entry", "take_profit"];
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
      if (dataMode === "sandbox") {
        updateSandboxStrategy(selectedStrategyData.id, {
          name: editingFormData.name,
          description: editingFormData.description ?? null,
          notes: currentNotes || null,
          color: editingFormData.color ?? null,
        });
        setIsEditing(false);
        setEditHistory([]);
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
        const savedStrategyId = selectedStrategyData.id;
        await loadStrategies(true);
        clearWorkInProgress();
        if (savedStrategyId) {
          setSelectedStrategy(savedStrategyId);
          setNotesContent(prev => {
            const updated = new Map(prev);
            updated.set(savedStrategyId, currentNotes || "");
            return updated;
          });
          await loadStrategyData(savedStrategyId);
          await loadChecklists(savedStrategyId);
        }
        return;
      }
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
        const defaultTypes = ["daily_analysis", "daily_mantra", "entry", "take_profit"];
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
      if (dataMode === "sandbox") {
        deleteSandboxStrategy(strategyToDelete);
        if (selectedStrategy === strategyToDelete) {
          setSelectedStrategy(null);
        }
        await loadStrategies();
        setShowDeleteConfirmModal(false);
        setStrategyToDelete(null);
        setAssociatedRecords(null);
        return;
      }
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

      if (dataMode === "sandbox") {
        const newStrategy = addSandboxStrategy({
          name: newName,
          description: strategy.description ?? null,
          notes: strategy.notes ?? null,
          color: strategy.color ?? null,
        });
        await loadStrategies();
        setSelectedStrategy(newStrategy.id);
        setActiveTab("notes");
        return;
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
            high_is_good: item.checklist_type === "survey" ? (item.high_is_good ?? true) : undefined,
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
              high_is_good: item.checklist_type === "survey" ? (item.high_is_good ?? true) : undefined,
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
          ) : sortedStrategies.length === 0 ? (
            <div
              style={{
                backgroundColor: "var(--bg-tertiary)",
                border: "1px solid var(--border-color)",
                borderRadius: "6px",
                padding: "18px",
                textAlign: "center",
                fontSize: "13px",
                color: "var(--text-secondary)",
              }}
            >
              No strategies match the current filters.
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
                      onClick={() => {
                        setSelectedStrategy(null);
                        setIsCreating(false);
                        setEditingFormData({ name: "", description: "", color: "#3b82f6" });
                        setEditHistory([]);
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
                      title="Strategies overview"
                    >
                      <LayoutDashboard size={16} />
                    </button>
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
                { id: "surveys" as TabType, label: "Surveys", icon: ClipboardList },
                { id: "survey" as TabType, label: "Metrics", icon: BarChart2 },
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
                              style={{
                                borderBottom: "1px solid var(--border-color)",
                                cursor: "pointer",
                              }}
                              onClick={() => setSelectedPairForChart(pair)}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor = "var(--bg-tertiary)";
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = "transparent";
                              }}
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

                const defaultTitleMap: Record<string, string> = {
                  "daily_mantra": "Mantra",
                  "daily_analysis": "Analysis",
                  "entry": "Entry Checklist",
                  "take_profit": "Take Profit Checklist",
                  "survey": "Survey",
                };
                const getChecklistTitle = (type: string): string => {
                  const custom = checklistTitles.get(virtualStrategyId)?.get(type);
                  if (custom?.trim()) return custom.trim();
                  return defaultTitleMap[type] || type.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') + " Checklist";
                };
                const onEditChecklistTitle = (type: string, newTitle: string) => {
                  const trimmed = newTitle.trim();
                  setChecklistTitles((prev) => {
                    const next = new Map(prev);
                    const strategyTitles = new Map(next.get(virtualStrategyId) || []);
                    if (trimmed) strategyTitles.set(type, trimmed);
                    else strategyTitles.delete(type);
                    next.set(virtualStrategyId, strategyTitles);
                    return next;
                  });
                };

                // Ordered checklist types: use saved order if any, else default first then custom. Allows custom above Analysis/Mantra/Entry/Take Profit.
                const defaultTypes = ["daily_analysis", "daily_mantra", "entry", "take_profit"];
                const tempCustomTypes = isCreating 
                  ? Array.from(new Set(Array.from(tempChecklists.keys()).filter(t => !defaultTypes.includes(t) && t !== "survey")))
                  : isEditing && selectedStrategy && editingChecklists.has(selectedStrategy)
                    ? Array.from(new Set(Array.from(currentChecklist.keys()).filter(t => !defaultTypes.includes(t) && t !== "survey")))
                    : (() => {
                        const checklistKeys = Array.from(currentChecklist.keys());
                        const customTypes = selectedStrategy ? Array.from(customChecklistTypes.get(selectedStrategy) || []) : [];
                        const allCustomKeys = new Set([...checklistKeys, ...customTypes]);
                        return Array.from(allCustomKeys).filter(t => !defaultTypes.includes(t) && t !== "survey");
                      })();
                const allNeeded = new Set([...defaultTypes, ...tempCustomTypes]);
                const savedOrder = checklistTypeOrder.get(virtualStrategyId);
                const allTypes = (() => {
                  if (!savedOrder || savedOrder.length === 0) {
                    return [...defaultTypes, ...tempCustomTypes.filter(t => !defaultTypes.includes(t))];
                  }
                  const ordered = savedOrder.filter((t: string) => allNeeded.has(t));
                  const appended = [...allNeeded].filter(t => !ordered.includes(t));
                  return [...ordered, ...appended];
                })();

                const unifiedHandleDragEnd = (event: DragEndEvent) => {
                  const { active, over } = event;
                  if (!over || active.id === over.id) return;
                  const activeId = active.id;
                  const overId = over.id;
                  const isSectionId = (id: unknown) => typeof id === "string" && String(id).startsWith("section:");
                  // Section reorder: ids are "section:entry", etc.
                  if (isSectionId(activeId)) {
                    const oldIndex = allTypes.findIndex((t) => `section:${t}` === activeId);
                    let newIndex = allTypes.findIndex((t) => `section:${t}` === overId);
                    // If dropped over an item, resolve to the section that contains that item
                    if (newIndex === -1 && (typeof overId === "number" || (typeof overId === "string" && !String(overId).startsWith("section:")))) {
                      const overItemId = typeof overId === "string" ? parseInt(overId, 10) : overId;
                      if (!Number.isNaN(overItemId)) {
                        for (let i = 0; i < allTypes.length; i++) {
                          const items = currentChecklist.get(allTypes[i]) || [];
                          if (items.some((it) => it.id === overItemId)) {
                            newIndex = i;
                            break;
                          }
                        }
                      }
                    }
                    if (oldIndex === -1 || newIndex === -1) return;
                    const newOrder = arrayMove(allTypes, oldIndex, newIndex);
                    setChecklistTypeOrder((prev) => {
                      const next = new Map(prev);
                      next.set(virtualStrategyId, newOrder);
                      return next;
                    });
                    return;
                  }
                  // Item reorder: only when over target is an item (same list), not a section
                  if (isSectionId(overId)) return;
                  const overItemId = typeof overId === "string" ? parseInt(overId, 10) : overId;
                  let typeForItem: string | null = null;
                  for (const [t, items] of currentChecklist.entries()) {
                    if (items.some((i) => i.id === activeId)) {
                      typeForItem = t;
                      break;
                    }
                  }
                  if (!typeForItem) return;
                  const items = currentChecklist.get(typeForItem) || [];
                  const oldIndex = items.findIndex((item) => item.id === activeId);
                  const newIndex = items.findIndex((item) => item.id === overItemId);
                  if (oldIndex === -1 || newIndex === -1) return;
                  const reorderedItems = arrayMove(items, oldIndex, newIndex);
                  const updatedItems = reorderedItems.map((item, index) => ({ ...item, item_order: index }));
                  const updatedChecklist = new Map(currentChecklist);
                  updatedChecklist.set(typeForItem, updatedItems);
                  if (isCreating) {
                    setTempChecklists(updatedChecklist);
                  } else if (isEditing && selectedStrategy && editingChecklists.has(selectedStrategy)) {
                    setEditingChecklists(new Map(editingChecklists.set(selectedStrategy, updatedChecklist)));
                    const history = checklistEditHistory.get(selectedStrategy) || [];
                    setChecklistEditHistory(new Map(checklistEditHistory.set(selectedStrategy, [...history, new Map(updatedChecklist)].slice(-10))));
                  } else {
                    reorderChecklistItems(virtualStrategyId, typeForItem, activeId as number, overItemId as number);
                  }
                };

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
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const deleted = await invoke<number>("remove_duplicate_checklist_items");
                              if (selectedStrategy) await loadChecklists(selectedStrategy);
                              if (deleted > 0) {
                                alert(`Removed ${deleted} duplicate checklist item(s).`);
                              } else {
                                alert("No duplicate checklist items found.");
                              }
                            } catch (e) {
                              console.error(e);
                              alert("Failed to remove duplicates: " + String(e));
                            }
                          }}
                          style={{
                            background: "transparent",
                            border: "1px solid var(--border-color)",
                            borderRadius: "6px",
                            padding: "8px 12px",
                            color: "var(--text-secondary)",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            fontSize: "13px",
                            fontWeight: "500",
                          }}
                        >
                          <CopyMinus size={16} />
                          Remove duplicates
                        </button>
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
                    </div>
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={unifiedHandleDragEnd}
                    >
                      <SortableContext id="checklist-sections" items={allTypes.map((t) => `section:${t}`)} strategy={verticalListSortingStrategy}>
                        <div>
                          {allTypes.map((type) => {
                            const isCustom = !defaultTypes.includes(type);
                            return (
                              <SortableChecklistSection key={type} type={type} isEditing={isEditing || isCreating}>
                                <ChecklistSection
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
                                  useParentDndContext
                                  onEditTitle={onEditChecklistTitle}
                                />
                              </SortableChecklistSection>
                            );
                          })}
                        </div>
                      </SortableContext>
                    </DndContext>
                  </div>
                );
              })()}

              {(activeTab === "survey" || activeTab === "surveys") && (selectedStrategy || isCreating) && (() => {
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

                // Survey types: built-in "survey" (Post-Trade) + any custom type starting with "survey_"
                const customSurveyTypeSet = new Set(
                  (selectedStrategy ? Array.from(customChecklistTypes.get(selectedStrategy) || []) : [])
                    .concat(Array.from(currentChecklist.keys()))
                    .filter((t) => t.startsWith("survey_"))
                );
                const surveyTypesOrdered = ["survey", ...Array.from(customSurveyTypeSet).sort()];
                const getSurveyTypeTitle = (type: string): string => {
                  if (type === "survey") return "Post-Trade Survey";
                  const custom = checklistTitles.get(virtualStrategyId)?.get(type);
                  if (custom?.trim()) return custom.trim();
                  return type.replace(/^survey_/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) + " Survey";
                };
                const canEditMetrics = isEditing || isCreating;
                // Ensure "survey" type exists
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
                  <>
                  {activeTab === "survey" && (
                  <div 
                    ref={(el) => { tabContentRefs.current.set("survey", el); }}
                    style={{ padding: "24px", overflowY: "auto" }}
                    onScroll={(e) => {
                      if (activeTab === "survey") {
                        tabScrollPositions.current.set("survey", e.currentTarget.scrollTop);
                      }
                    }}
                  >
                    {/* Survey metrics – calculation presets and metrics together */}
                    <div style={{ marginBottom: "24px", paddingBottom: "20px", borderBottom: "1px solid var(--border-color)" }}>
                      <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "16px", maxWidth: "560px" }}>
                        Tie metrics to survey items (add items in the Surveys tab). Use calculation presets or inline formulas. Choose which items feed each metric and how the score is calculated (average, min, max, or a saved preset).
                      </p>
                      {/* Calculation presets – grouped with survey metrics */}
                      <div style={{ marginBottom: "16px" }}>
                        <h3 style={{ fontSize: "14px", fontWeight: "600", color: "var(--text-secondary)", margin: "0 0 8px 0", textTransform: "uppercase", letterSpacing: "0.02em" }}>
                          Calculation presets
                        </h3>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "8px" }}>
                          {(isCreating ? tempCalculationPresets : calculationPresets).map((p, idx) => (
                            <div
                              key={isCreating ? `temp-${idx}` : (p as unknown as { id: number }).id}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                                padding: "8px 12px",
                                borderRadius: "8px",
                                border: "1px solid var(--border-color)",
                                backgroundColor: "var(--bg-tertiary)",
                                fontSize: "13px",
                              }}
                            >
                              <span style={{ color: "var(--text-primary)", fontWeight: "500" }}>{p.name}</span>
                              <span style={{ color: "var(--text-secondary)", fontSize: "11px" }}>
                                {(() => {
                                  const expr = (p as { formula_expression?: string | null }).formula_expression?.trim();
                                  if (expr) return expr;
                                  const ft = (p as { formula_type?: string }).formula_type;
                                  return ft === "invert" ? "6 − avg" : ft === "min" ? "min" : ft === "max" ? "max" : "avg";
                                })()}
                              </span>
                              {canEditMetrics && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setPresetForm({ name: p.name, formula_expression: (p as { formula_expression?: string }).formula_expression ?? "" });
                                      setPresetModal(isCreating ? idx : (p as unknown as { id: number }).id);
                                    }}
                                    style={{ padding: "4px", border: "1px solid var(--border-color)", borderRadius: "6px", background: "var(--bg-secondary)", color: "var(--text-primary)", cursor: "pointer" }}
                                    title="Edit preset"
                                  >
                                    <Edit2 size={12} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (!confirm("Delete this preset?")) return;
                                      if (isCreating) {
                                        setTempCalculationPresets((prev) => prev.filter((_, i) => i !== idx));
                                      } else {
                                        invoke("delete_strategy_calculation_preset", { id: (p as unknown as { id: number }).id })
                                          .then(() => invoke<Array<{ id: number; strategy_id: number; name: string; formula_type: string; formula_expression?: string | null; display_order: number }>>("get_strategy_calculation_presets", { strategyId: selectedStrategy! }))
                                          .then(setCalculationPresets)
                                          .catch((e) => console.error(e));
                                      }
                                    }}
                                    style={{ padding: "4px", border: "1px solid var(--border-color)", borderRadius: "6px", background: "var(--bg-secondary)", color: "var(--danger)", cursor: "pointer" }}
                                    title="Delete preset"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                        {canEditMetrics && (
                          <button
                            type="button"
                            onClick={() => { setPresetForm({ name: "", formula_expression: "" }); setPresetModal("add"); }}
                            style={{
                              padding: "6px 12px",
                              borderRadius: "6px",
                              border: "1px solid var(--border-color)",
                              background: "var(--bg-secondary)",
                              color: "var(--text-primary)",
                              fontSize: "12px",
                              cursor: "pointer",
                            }}
                          >
                            + Add preset
                          </button>
                        )}
                      </div>
                      {/* Survey metrics label above the metric cards */}
                      <h2 style={{ fontSize: "20px", fontWeight: "700", color: "var(--text-primary)", margin: "0 0 12px 0" }}>
                        Survey metrics
                      </h2>
                      {/* Metric cards and Add metric */}
                      {(() => {
                        const surveyItemsForMetrics = (currentChecklist.get("survey") || []).filter((i) => i.item_text !== EMPTY_CUSTOM_CHECKLIST_PLACEHOLDER);
                        const hasSurveyItems = surveyItemsForMetrics.length > 0;
                        const metricsToShow = isCreating ? tempSurveyMetrics : customSurveyMetricDefinitions;
                        return (
                        <>
                        {!hasSurveyItems && (
                          <div style={{ padding: "14px 16px", borderRadius: "8px", border: "1px solid var(--border-color)", backgroundColor: "var(--bg-tertiary)", fontSize: "13px", color: "var(--text-secondary)", marginBottom: "12px" }}>
                            Add survey items under the Surveys section below before creating a metric. Metrics are calculated from your survey questions.
                          </div>
                        )}
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", marginBottom: "12px" }}>
                          {metricsToShow.map((m, idx) => {
                            const isTemp = isCreating;
                            const mId = isTemp ? undefined : (m as { id: number }).id;
                            const mItemIds = isTemp ? (m as { item_ids: number[] }).item_ids : (JSON.parse((m as { item_ids: string }).item_ids || "[]") as number[]);
                            const mColorScale = isTemp ? (m as { color_scale: string | null }).color_scale : (m as { color_scale: string | null }).color_scale;
                            const raw = !isTemp && (m as { computed_value: number | null }).computed_value != null ? (m as { computed_value: number }).computed_value : 3;
                            const displayVal = Math.max(0, Math.min(5, (raw - 1) * (5 / 4)));
                            const pct = displayVal / 5;
                            const barColor = getMetricColorFromScale(pct, mColorScale ?? undefined);
                            return (
                              <div
                                key={isTemp ? `temp-${idx}` : mId}
                                style={{
                                  backgroundColor: "var(--bg-tertiary)",
                                  border: "1px solid var(--border-color)",
                                  borderRadius: "8px",
                                  padding: "14px",
                                  minWidth: "200px",
                                  maxWidth: "280px",
                                }}
                              >
                                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px", marginBottom: "6px" }}>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: "12px", fontWeight: "600", marginBottom: "2px" }}>{m.name}</div>
                                    <div style={{ fontSize: "18px", fontWeight: "bold", color: barColor }}>
                                      {!isTemp && (m as { computed_value: number | null }).computed_value != null ? displayVal.toFixed(2) : "—"}
                                      <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>/5</span>
                                    </div>
                                  </div>
                                  {canEditMetrics && (
                                    <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          let colorScaleType: "gradient" | "static" = "gradient";
                                          let colorScalePreset = "ryg";
                                          let colorScaleStatic = "#3b82f6";
                                          try {
                                            if (mColorScale) {
                                              const cs = JSON.parse(mColorScale) as { type?: string; preset?: string; hex?: string };
                                              if (cs.type === "static" && cs.hex) {
                                                colorScaleType = "static";
                                                colorScaleStatic = cs.hex;
                                              } else if (cs.type === "gradient" && cs.preset && METRIC_COLOR_GRADIENTS[cs.preset]) {
                                                colorScalePreset = cs.preset;
                                              }
                                            }
                                          } catch { /* use defaults */ }
                                          setSurveyMetricForm({
                                            name: m.name,
                                            description: (m as { description: string | null }).description || "",
                                            formula_type: m.formula_type || "avg",
                                            item_ids: mItemIds,
                                            color_scale_type: colorScaleType,
                                            color_scale_preset: colorScalePreset,
                                            color_scale_static: colorScaleStatic,
                                          });
                                          setSurveyMetricModal(isTemp ? idx : mId!);
                                        }}
                                        style={{ padding: "4px", border: "1px solid var(--border-color)", borderRadius: "6px", background: "var(--bg-secondary)", color: "var(--text-primary)", cursor: "pointer" }}
                                        title="Edit metric"
                                      >
                                        <Edit2 size={14} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={async () => {
                                          if (!confirm("Delete this metric? This cannot be undone.")) return;
                                          if (isTemp) {
                                            setTempSurveyMetrics((prev) => prev.filter((_, i) => i !== idx));
                                            return;
                                          }
                                          try {
                                            await invoke("delete_strategy_survey_metric", { id: mId });
                                            const [rawData, defs] = await Promise.all([
                                              invoke<Array<{ checklist_item_id: number; item_text: string; response_count: number; avg_value: number | null }>>("get_custom_survey_metrics", { strategyId: selectedStrategy! }),
                                              invoke<Array<{ id: number; strategy_id: number; name: string; description: string | null; formula_type: string; item_ids: string; display_order: number; computed_value: number | null; color_scale: string | null }>>("get_strategy_survey_metrics_with_values", { strategyId: selectedStrategy! }),
                                            ]);
                                            setCustomSurveyMetrics(rawData);
                                            setCustomSurveyMetricDefinitions(defs);
                                          } catch (e) { console.error(e); }
                                        }}
                                        style={{ padding: "4px", border: "1px solid var(--border-color)", borderRadius: "6px", background: "var(--bg-secondary)", color: "var(--danger, #ef4444)", cursor: "pointer" }}
                                        title="Delete metric"
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    </div>
                                  )}
                                </div>
                                <div style={{ height: "4px", backgroundColor: "var(--bg-secondary)", borderRadius: "2px", overflow: "hidden", marginBottom: "6px" }}>
                                  <div style={{ height: "100%", width: `${pct * 100}%`, backgroundColor: barColor, transition: "width 0.2s" }} />
                                </div>
                                {m.description && <p style={{ fontSize: "11px", color: "var(--text-secondary)", lineHeight: "1.35", margin: 0 }}>{m.description}</p>}
                                <div style={{ fontSize: "10px", color: "var(--text-secondary)", marginTop: "4px" }}>
                                  {m.formula_type.startsWith("preset:")
                                    ? "Preset formula"
                                    : m.formula_type === "invert"
                                      ? "6 − avg (lower raw = better)"
                                      : m.formula_type === "min"
                                        ? "min (higher = better)"
                                        : m.formula_type === "max"
                                          ? "max (higher = better)"
                                          : "avg (higher = better)"}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        {canEditMetrics && (
                          <button
                            type="button"
                            onClick={() => {
                              if (!hasSurveyItems) {
                                return; // prompt is already shown above
                              }
                              setSurveyMetricForm({
                                name: "",
                                description: "",
                                formula_type: "avg",
                                item_ids: [],
                                color_scale_type: "gradient",
                                color_scale_preset: "ryg",
                                color_scale_static: "#3b82f6",
                              });
                              setSurveyMetricModal("add");
                            }}
                            style={{
                              padding: "8px 14px",
                              borderRadius: "6px",
                              border: "1px solid var(--border-color)",
                              background: hasSurveyItems ? "var(--bg-secondary)" : "var(--bg-tertiary)",
                              color: "var(--text-primary)",
                              fontSize: "13px",
                              fontWeight: "500",
                              cursor: hasSurveyItems ? "pointer" : "not-allowed",
                              opacity: hasSurveyItems ? 1 : 0.7,
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "6px",
                            }}
                            title={!hasSurveyItems ? "Create a survey item above first" : undefined}
                          >
                            <Plus size={16} /> Add metric
                          </button>
                        )}
                        </>
                        );
                      })()}
                    </div>

                    {/* Checklist & survey item metrics: when each item was checked, avg performance (R → % → price) */}
                    {checklistItemMetrics.length > 0 && (
                      <div style={{ marginTop: "24px", paddingTop: "20px", borderTop: "1px solid var(--border-color)" }}>
                        <h3 style={{ fontSize: "14px", fontWeight: "600", color: "var(--text-secondary)", margin: "0 0 8px 0", textTransform: "uppercase", letterSpacing: "0.02em" }}>
                          Checklist & survey item metrics
                        </h3>
                        <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "12px", maxWidth: "560px" }}>
                          When each item was checked in Journal, performance uses R-multiple if set; otherwise % return or P&L from linked trades.
                        </p>
                        <div style={{ overflowX: "auto" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                            <thead>
                              <tr style={{ borderBottom: "1px solid var(--border-color)" }}>
                                <th style={{ textAlign: "left", padding: "8px", color: "var(--text-secondary)", fontWeight: "600" }}>Item</th>
                                <th style={{ textAlign: "left", padding: "8px", color: "var(--text-secondary)", fontWeight: "600" }}>Type</th>
                                <th style={{ textAlign: "right", padding: "8px", color: "var(--text-secondary)", fontWeight: "600" }}>Times checked</th>
                                <th style={{ textAlign: "right", padding: "8px", color: "var(--text-secondary)", fontWeight: "600" }}>Avg performance</th>
                              </tr>
                            </thead>
                            <tbody>
                              {checklistItemMetrics.filter((row) => row.item_text !== EMPTY_CUSTOM_CHECKLIST_PLACEHOLDER).map((row) => (
                                <tr key={row.checklist_item_id} style={{ borderBottom: "1px solid var(--border-color)" }}>
                                  <td style={{ padding: "8px", color: "var(--text-primary)" }}>{row.item_text}</td>
                                  <td style={{ padding: "8px", color: "var(--text-secondary)" }}>{row.checklist_type === "survey" ? "Post-Trade Survey" : row.checklist_type === "entry" ? "Entry" : row.checklist_type === "exit" ? "Exit" : row.checklist_type.replace(/^survey_/, "").replace(/_/g, " ")}</td>
                                  <td style={{ padding: "8px", textAlign: "right", color: "var(--text-primary)" }}>{row.times_checked}</td>
                                  <td style={{ padding: "8px", textAlign: "right", color: row.avg_performance != null && row.avg_performance < 0 ? "var(--loss)" : "var(--text-primary)" }}>
                                    {formatChecklistAvgPerformance(row.avg_performance, row.performance_kind)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {surveyMetricModal !== null && (() => {
                      const surveyItemsForMetric = surveyTypesOrdered.flatMap((t) => (currentChecklist.get(t) || []).filter((item) => item.item_text !== EMPTY_CUSTOM_CHECKLIST_PLACEHOLDER));
                      return (
                        <div
                          style={{
                            position: "fixed",
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            backgroundColor: "rgba(0,0,0,0.6)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            zIndex: 1000,
                          }}
                          onClick={() => { setSurveyMetricModal(null); setColorPresetDropdownOpen(false); }}
                        >
                          <div
                            style={{
                              backgroundColor: "var(--bg-secondary)",
                              border: "1px solid var(--border-color)",
                              borderRadius: "12px",
                              padding: "16px 20px",
                              width: "90%",
                              maxWidth: "440px",
                              maxHeight: "85vh",
                              overflowY: "auto",
                              boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
                            }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <h3 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "12px", color: "var(--text-primary)" }}>
                              {surveyMetricModal === "add" ? "Add metric" : "Edit metric"}
                            </h3>
                            <div style={{ marginBottom: "10px" }}>
                              <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", marginBottom: "4px" }}>Name</label>
                              <input
                                type="text"
                                value={surveyMetricForm.name}
                                onChange={(e) => setSurveyMetricForm((f) => ({ ...f, name: e.target.value }))}
                                placeholder="e.g. Discipline score"
                                style={{ width: "100%", padding: "8px 10px", borderRadius: "6px", border: "1px solid var(--border-color)", background: "var(--bg-primary)", color: "var(--text-primary)" }}
                              />
                            </div>
                            <div style={{ marginBottom: "10px" }}>
                              <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", marginBottom: "4px" }}>Description (optional)</label>
                              <textarea
                                value={surveyMetricForm.description}
                                onChange={(e) => setSurveyMetricForm((f) => ({ ...f, description: e.target.value }))}
                                placeholder="What this metric means"
                                rows={1}
                                style={{ width: "100%", padding: "6px 8px", borderRadius: "6px", border: "1px solid var(--border-color)", background: "var(--bg-primary)", color: "var(--text-primary)", resize: "vertical", minHeight: "32px" }}
                              />
                            </div>
                            <div style={{ marginBottom: "12px" }}>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
                                <label style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)" }}>Calculation</label>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPresetForm({ name: "", formula_expression: "" });
                                    setPresetModal("add");
                                    setOpenPresetFromMetricModal(true);
                                  }}
                                  style={{ fontSize: "11px", padding: "4px 8px", borderRadius: "4px", border: "1px solid var(--border-color)", background: "var(--bg-tertiary)", color: "var(--text-secondary)", cursor: "pointer" }}
                                >
                                  + Create preset
                                </button>
                              </div>
                              <select
                                value={surveyMetricForm.formula_type}
                                onChange={(e) => setSurveyMetricForm((f) => ({ ...f, formula_type: e.target.value }))}
                                style={{ width: "100%", padding: "8px 10px", borderRadius: "6px", border: "1px solid var(--border-color)", background: "var(--bg-primary)", color: "var(--text-primary)" }}
                              >
                                {(isCreating ? tempCalculationPresets : calculationPresets).map((p, idx) => {
                                  const preset = p as { name: string; formula_type?: string; formula_expression?: string | null };
                                  const formulaLabel = (preset.formula_expression && preset.formula_expression.trim()) ? preset.formula_expression.trim() : (preset.formula_type === "invert" ? "6 − avg" : preset.formula_type === "min" ? "min" : preset.formula_type === "max" ? "max" : "avg");
                                  return (
                                    <option key={isCreating ? `temp-${idx}` : (p as unknown as { id: number }).id} value={isCreating ? `preset:${idx}` : `preset:${(p as unknown as { id: number }).id}`}>
                                      Preset: {preset.name} ({formulaLabel})
                                    </option>
                                  );
                                })}
                                {(isCreating ? tempCalculationPresets : calculationPresets).length > 0 && <option disabled>— Inline —</option>}
                                <option value="avg">Average (higher = better)</option>
                                <option value="invert">Inverted (6 − avg; lower raw = better)</option>
                                <option value="min">Min of items (higher = better)</option>
                                <option value="max">Max of items (higher = better)</option>
                              </select>
                            </div>
                            <div style={{ marginBottom: "12px" }}>
                              <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", marginBottom: "4px" }}>Color scale</label>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
                                <button
                                  type="button"
                                  onClick={() => setSurveyMetricForm((f) => ({ ...f, color_scale_type: "gradient" }))}
                                  style={{
                                    padding: "4px 10px",
                                    borderRadius: "4px",
                                    border: `1px solid ${surveyMetricForm.color_scale_type === "gradient" ? "var(--accent)" : "var(--border-color)"}`,
                                    background: surveyMetricForm.color_scale_type === "gradient" ? "var(--bg-tertiary)" : "var(--bg-secondary)",
                                    color: "var(--text-primary)",
                                    fontSize: "11px",
                                    cursor: "pointer",
                                  }}
                                >
                                  Gradient
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setSurveyMetricForm((f) => ({ ...f, color_scale_type: "static" }))}
                                  style={{
                                    padding: "4px 10px",
                                    borderRadius: "4px",
                                    border: `1px solid ${surveyMetricForm.color_scale_type === "static" ? "var(--accent)" : "var(--border-color)"}`,
                                    background: surveyMetricForm.color_scale_type === "static" ? "var(--bg-tertiary)" : "var(--bg-secondary)",
                                    color: "var(--text-primary)",
                                    fontSize: "11px",
                                    cursor: "pointer",
                                  }}
                                >
                                  Solid
                                </button>
                                {surveyMetricForm.color_scale_type === "gradient" ? (
                                  <div style={{ position: "relative" }}>
                                    <button
                                      type="button"
                                      onClick={() => setColorPresetDropdownOpen((o) => !o)}
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "8px",
                                        padding: "4px 8px 4px 10px",
                                        borderRadius: "4px",
                                        border: "1px solid var(--border-color)",
                                        background: "var(--bg-primary)",
                                        color: "var(--text-primary)",
                                        fontSize: "12px",
                                        minWidth: "180px",
                                        cursor: "pointer",
                                        textAlign: "left",
                                      }}
                                    >
                                      <div
                                        style={{
                                          width: "64px",
                                          height: "14px",
                                          borderRadius: "3px",
                                          background: metricGradientCss(surveyMetricForm.color_scale_preset),
                                          border: "1px solid var(--border-color)",
                                          flexShrink: 0,
                                        }}
                                      />
                                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {METRIC_COLOR_PRESET_LABELS[surveyMetricForm.color_scale_preset]}
                                      </span>
                                      <ChevronDown size={14} style={{ flexShrink: 0, opacity: colorPresetDropdownOpen ? 0.8 : 0.5 }} />
                                    </button>
                                    {colorPresetDropdownOpen && (
                                      <div
                                        style={{
                                          position: "absolute",
                                          bottom: "100%",
                                          left: 0,
                                          marginBottom: "2px",
                                          minWidth: "100%",
                                          maxHeight: "220px",
                                          overflowY: "auto",
                                          borderRadius: "6px",
                                          border: "1px solid var(--border-color)",
                                          background: "var(--bg-primary)",
                                          boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                                          zIndex: 10,
                                          display: "flex",
                                          flexDirection: "column-reverse",
                                        }}
                                      >
                                        {Object.entries(METRIC_COLOR_PRESET_LABELS).map(([key, label]) => (
                                          <button
                                            key={key}
                                            type="button"
                                            onClick={() => {
                                              setSurveyMetricForm((f) => ({ ...f, color_scale_preset: key }));
                                              setColorPresetDropdownOpen(false);
                                            }}
                                            style={{
                                              display: "flex",
                                              alignItems: "center",
                                              gap: "8px",
                                              width: "100%",
                                              padding: "6px 10px",
                                              border: "none",
                                              background: surveyMetricForm.color_scale_preset === key ? "var(--bg-tertiary)" : "transparent",
                                              color: "var(--text-primary)",
                                              fontSize: "12px",
                                              cursor: "pointer",
                                              textAlign: "left",
                                            }}
                                          >
                                            <div
                                              style={{
                                                width: "56px",
                                                height: "12px",
                                                borderRadius: "2px",
                                                background: metricGradientCss(key),
                                                border: "1px solid var(--border-color)",
                                                flexShrink: 0,
                                              }}
                                            />
                                            <span>{label}</span>
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <>
                                    <ColorPicker
                                      value={surveyMetricForm.color_scale_static}
                                      onChange={(hex) => setSurveyMetricForm((f) => ({ ...f, color_scale_static: hex }))}
                                    />
                                    <div style={{ width: "24px", height: "18px", borderRadius: "3px", background: surveyMetricForm.color_scale_static, border: "1px solid var(--border-color)" }} />
                                    <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>{surveyMetricForm.color_scale_static}</span>
                                  </>
                                )}
                              </div>
                              <p style={{ fontSize: "10px", color: "var(--text-secondary)", margin: "4px 0 0 0" }}>
                                Applied to score and progress bar (low → high).
                              </p>
                            </div>
                            <div style={{ marginBottom: "12px" }}>
                              <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", marginBottom: "4px" }}>Survey items (select which questions feed this metric)</label>
                              <div style={{ maxHeight: "120px", overflowY: "auto", border: "1px solid var(--border-color)", borderRadius: "6px", padding: "6px 8px", background: "var(--bg-tertiary)" }}>
                                {surveyItemsForMetric.length === 0 ? (
                                  <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Add survey items above first.</div>
                                ) : (
                                  surveyItemsForMetric.map((item) => (
                                    <label key={item.id} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "4px 0", cursor: "pointer", fontSize: "13px" }}>
                                      <input
                                        type="checkbox"
                                        checked={surveyMetricForm.item_ids.includes(item.id)}
                                        onChange={(e) => {
                                          setSurveyMetricForm((f) => ({
                                            ...f,
                                            item_ids: e.target.checked ? [...f.item_ids, item.id] : f.item_ids.filter((id) => id !== item.id),
                                          }));
                                        }}
                                      />
                                      <span style={{ color: "var(--text-primary)" }}>{item.item_text === EMPTY_CUSTOM_CHECKLIST_PLACEHOLDER ? "—" : item.item_text}</span>
                                    </label>
                                  ))
                                )}
                              </div>
                            </div>
                            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                              <button
                                type="button"
                                onClick={() => { setSurveyMetricModal(null); setColorPresetDropdownOpen(false); }}
                                style={{ padding: "8px 16px", borderRadius: "6px", border: "1px solid var(--border-color)", background: "var(--bg-secondary)", color: "var(--text-primary)", cursor: "pointer" }}
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  if (!surveyMetricForm.name.trim()) return;
                                  const colorScale =
                                    surveyMetricForm.color_scale_type === "static"
                                      ? JSON.stringify({ type: "static", hex: surveyMetricForm.color_scale_static })
                                      : JSON.stringify({ type: "gradient", preset: surveyMetricForm.color_scale_preset });
                                  const formulaType = surveyMetricForm.formula_type;
                                  if (isCreating) {
                                    const entry = {
                                      name: surveyMetricForm.name.trim(),
                                      description: surveyMetricForm.description.trim() || null,
                                      formula_type: formulaType,
                                      item_ids: surveyMetricForm.item_ids,
                                      display_order: surveyMetricModal === "add" ? tempSurveyMetrics.length : (surveyMetricModal as number),
                                      color_scale: colorScale as string | null,
                                    };
                                    if (surveyMetricModal === "add") {
                                      setTempSurveyMetrics((prev) => [...prev, { ...entry, display_order: prev.length }]);
                                    } else {
                                      const idx = surveyMetricModal as number;
                                      setTempSurveyMetrics((prev) => prev.map((m, i) => i === idx ? { ...entry, display_order: idx } : m));
                                    }
                                    setSurveyMetricModal(null);
                                    setColorPresetDropdownOpen(false);
                                    return;
                                  }
                                  if (selectedStrategy == null) return;
                                  try {
                                    const displayOrder = surveyMetricModal === "add" ? customSurveyMetricDefinitions.length : customSurveyMetricDefinitions.find((d) => d.id === surveyMetricModal)?.display_order ?? 0;
                                    await invoke("save_strategy_survey_metric", {
                                      id: surveyMetricModal === "add" ? null : surveyMetricModal,
                                      strategyId: selectedStrategy,
                                      name: surveyMetricForm.name.trim(),
                                      description: surveyMetricForm.description.trim() || null,
                                      formulaType,
                                      itemIds: JSON.stringify(surveyMetricForm.item_ids),
                                      displayOrder,
                                      colorScale,
                                    });
                                    const [raw, defs] = await Promise.all([
                                      invoke<Array<{ checklist_item_id: number; item_text: string; response_count: number; avg_value: number | null }>>("get_custom_survey_metrics", { strategyId: selectedStrategy }),
                                      invoke<Array<{ id: number; strategy_id: number; name: string; description: string | null; formula_type: string; item_ids: string; display_order: number; computed_value: number | null; color_scale: string | null }>>("get_strategy_survey_metrics_with_values", { strategyId: selectedStrategy }),
                                    ]);
                                    setCustomSurveyMetrics(raw);
                                    setCustomSurveyMetricDefinitions(defs);
                                    setSurveyMetricModal(null);
                                    setColorPresetDropdownOpen(false);
                                  } catch (e) {
                                    console.error(e);
                                  }
                                }}
                                style={{ padding: "8px 16px", borderRadius: "6px", border: "none", background: "var(--accent)", color: "white", cursor: "pointer", fontWeight: "500" }}
                              >
                                Save
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                    {presetModal !== null && (
                      <div
                        style={{
                          position: "fixed",
                          top: 0,
                          left: 0,
                          right: 0,
                          bottom: 0,
                          backgroundColor: "rgba(0,0,0,0.6)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          zIndex: 1000,
                        }}
                        onClick={() => { setPresetModal(null); setOpenPresetFromMetricModal(false); }}
                      >
                        <div
                          style={{
                            backgroundColor: "var(--bg-secondary)",
                            border: "1px solid var(--border-color)",
                            borderRadius: "12px",
                            padding: "24px",
                            width: "90%",
                            maxWidth: "360px",
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <h3 style={{ fontSize: "18px", fontWeight: "600", marginBottom: "16px", color: "var(--text-primary)" }}>
                            {presetModal === "add" ? "Add calculation preset" : "Edit preset"}
                          </h3>
                          <div style={{ marginBottom: "12px" }}>
                            <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", marginBottom: "4px" }}>Name</label>
                            <input
                              type="text"
                              value={presetForm.name}
                              onChange={(e) => setPresetForm((f) => ({ ...f, name: e.target.value }))}
                              placeholder="e.g. Discipline score"
                              style={{ width: "100%", padding: "8px 10px", borderRadius: "6px", border: "1px solid var(--border-color)", background: "var(--bg-primary)", color: "var(--text-primary)" }}
                            />
                          </div>
                          <div style={{ marginBottom: "16px" }}>
                            <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", marginBottom: "4px" }}>Formula</label>
                            <input
                              type="text"
                              value={presetForm.formula_expression}
                              onChange={(e) => setPresetForm((f) => ({ ...f, formula_expression: e.target.value }))}
                              placeholder="e.g. (v1 + v2) / 2 or 6 - (v1 + v2 + v3) / 3"
                              style={{ width: "100%", padding: "8px 10px", borderRadius: "6px", border: "1px solid var(--border-color)", background: "var(--bg-primary)", color: "var(--text-primary)", fontFamily: "monospace" }}
                            />
                            <p style={{ fontSize: "11px", color: "var(--text-secondary)", margin: "6px 0 0 0" }}>
                              Use v1, v2, v3, … for the 1st, 2nd, 3rd … survey item you select in the metric. Math: + - * / ( ). Example: (v1 + v2) / 2 for average of two items.
                            </p>
                          </div>
                          <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                            <button
                              type="button"
                              onClick={() => { setPresetModal(null); setOpenPresetFromMetricModal(false); }}
                              style={{ padding: "8px 16px", borderRadius: "6px", border: "1px solid var(--border-color)", background: "var(--bg-secondary)", color: "var(--text-primary)", cursor: "pointer" }}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                if (!presetForm.name.trim()) return;
                                const expr = presetForm.formula_expression.trim();
                                if (!expr) return;
                                if (isCreating) {
                                  if (presetModal === "add") {
                                    setTempCalculationPresets((prev) => {
                                      const next = [...prev, { name: presetForm.name.trim(), formula_expression: expr, display_order: prev.length }];
                                      if (openPresetFromMetricModal) {
                                        setSurveyMetricForm((f) => ({ ...f, formula_type: "preset:" + (next.length - 1) }));
                                        setOpenPresetFromMetricModal(false);
                                      }
                                      return next;
                                    });
                                  } else {
                                    const idx = presetModal as number;
                                    setTempCalculationPresets((prev) => prev.map((p, i) => i === idx ? { ...p, name: presetForm.name.trim(), formula_expression: expr } : p));
                                  }
                                  setPresetModal(null);
                                  return;
                                }
                                if (selectedStrategy == null) return;
                                try {
                                  const displayOrder = presetModal === "add" ? calculationPresets.length : calculationPresets.find((p) => p.id === presetModal)?.display_order ?? 0;
                                  const id = await invoke<number>("save_strategy_calculation_preset", {
                                    id: presetModal === "add" ? null : presetModal,
                                    strategyId: selectedStrategy,
                                    name: presetForm.name.trim(),
                                    formulaType: "custom",
                                    formulaExpression: expr,
                                    displayOrder,
                                  });
                                  const presets = await invoke<Array<{ id: number; strategy_id: number; name: string; formula_type: string; formula_expression?: string | null; display_order: number }>>("get_strategy_calculation_presets", { strategyId: selectedStrategy });
                                  setCalculationPresets(presets);
                                  if (openPresetFromMetricModal && presetModal === "add") {
                                    setSurveyMetricForm((f) => ({ ...f, formula_type: "preset:" + id }));
                                    setOpenPresetFromMetricModal(false);
                                  }
                                  setPresetModal(null);
                                } catch (e) { console.error(e); }
                              }}
                              style={{ padding: "8px 16px", borderRadius: "6px", border: "none", background: "var(--accent)", color: "white", cursor: "pointer", fontWeight: "500" }}
                            >
                              Save
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  )}
                  {activeTab === "surveys" && (
                  <div
                    ref={(el) => { tabContentRefs.current.set("surveys", el); }}
                    style={{ padding: "24px", overflowY: "auto" }}
                    onScroll={(e) => {
                      if (activeTab === "surveys") {
                        tabScrollPositions.current.set("surveys", e.currentTarget.scrollTop);
                      }
                    }}
                  >
                    <div
                      style={{
                        padding: "20px",
                        borderRadius: "12px",
                        border: "1px solid var(--border-color)",
                        backgroundColor: "var(--bg-secondary)",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px", marginBottom: "8px" }}>
                        <div>
                          <h2 style={{ fontSize: "20px", fontWeight: "700", color: "var(--text-primary)", margin: "0 0 4px 0" }}>
                            Surveys
                          </h2>
                          <p style={{ fontSize: "14px", color: "var(--text-secondary)", margin: 0, maxWidth: "560px" }}>
                            Add survey questions (1–5 scale) under each survey. Post-Trade Survey is used in Journal when logging trades. Survey items can be tied to survey metrics in the Metrics tab.
                          </p>
                        </div>
                        {canEditMetrics && (
                          <button
                            type="button"
                            onClick={() => setShowAddSurveyModal(true)}
                            style={{
                              padding: "8px 14px",
                              borderRadius: "6px",
                              border: "1px solid var(--border-color)",
                              background: "var(--bg-tertiary)",
                              color: "var(--text-primary)",
                              fontSize: "13px",
                              fontWeight: "500",
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "6px",
                              flexShrink: 0,
                            }}
                          >
                            <Plus size={16} /> Add survey
                          </button>
                        )}
                      </div>
                    {surveyTypesOrdered.map((surveyType) => {
                      const items = currentChecklist.get(surveyType) || [];
                      const isCustomSurvey = surveyType.startsWith("survey_");
                      return (
                        <div key={surveyType} style={{ marginBottom: "24px" }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                            <h3 style={{ fontSize: "16px", fontWeight: "600", color: "var(--text-primary)", margin: 0 }}>
                              {getSurveyTypeTitle(surveyType)}
                            </h3>
                            {canEditMetrics && isCustomSurvey && (
                              <button
                                type="button"
                                onClick={() => {
                                  deleteChecklistType(virtualStrategyId, surveyType);
                                  if (isEditing && selectedStrategy != null) {
                                    const customSet = new Set(customChecklistTypes.get(selectedStrategy) || []);
                                    customSet.delete(surveyType);
                                    setCustomChecklistTypes(new Map(customChecklistTypes.set(selectedStrategy, customSet)));
                                  }
                                }}
                                style={{ padding: "4px 8px", fontSize: "12px", border: "1px solid var(--border-color)", borderRadius: "6px", background: "var(--bg-secondary)", color: "var(--danger, #ef4444)", cursor: "pointer" }}
                              >
                                Delete survey
                              </button>
                            )}
                          </div>
                          <ChecklistSection
                              type={surveyType}
                              title={getSurveyTypeTitle(surveyType)}
                              items={items}
                              selectedStrategy={virtualStrategyId}
                              isEditing={canEditMetrics}
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
                              isCustom={isCustomSurvey}
                              onDeleteChecklist={undefined}
                              moveItemsToGroup={moveItemsToGroup}
                            />
                        </div>
                      );
                    })}
                    </div>
                    {!isCreating && selectedStrategy != null && customSurveyMetrics.length > 0 && (
                      <div style={{ marginTop: "24px", paddingTop: "20px", borderTop: "1px solid var(--border-color)" }}>
                        <h4 style={{ fontSize: "14px", fontWeight: "600", color: "var(--text-secondary)", marginBottom: "12px" }}>
                          Survey metrics (from journal entries)
                        </h4>
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                          {customSurveyMetrics.map((m) => (
                            <div
                              key={m.checklist_item_id}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                padding: "8px 12px",
                                backgroundColor: "var(--bg-tertiary)",
                                borderRadius: "6px",
                                fontSize: "13px",
                              }}
                            >
                              <span style={{ color: "var(--text-primary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={m.item_text === EMPTY_CUSTOM_CHECKLIST_PLACEHOLDER ? "" : m.item_text}>
                                {m.item_text === EMPTY_CUSTOM_CHECKLIST_PLACEHOLDER ? "—" : m.item_text}
                              </span>
                              <span style={{ color: "var(--text-secondary)", marginLeft: "12px" }}>
                                {m.response_count} response{m.response_count !== 1 ? "s" : ""}
                                {m.avg_value != null ? ` · avg ${Number(m.avg_value).toFixed(1)}` : ""}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {!isCreating && selectedStrategy != null && (() => {
                      const items = selectedStrategySurveyInsightItems;
                      const insightByType = new Map<string, ChecklistItemMetricByOutcomeRow[]>();
                      items.forEach((row) => {
                        const type = row.checklist_type || "other";
                        if (!insightByType.has(type)) insightByType.set(type, []);
                        insightByType.get(type)!.push(row);
                      });
                      const isSurveyType = (display: string) => display.toLowerCase().startsWith("survey");
                      const winningSurvey: Array<{ checklistTypeDisplay: string; topItemText: string; good: number; key: string }> = [];
                      const losingSurvey: Array<{ checklistTypeDisplay: string; topItemText: string; bad: number; key: string }> = [];
                      insightByType.forEach((rows, type) => {
                        if (!isSurveyType(type.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "))) return;
                        const typeDisplay = type.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
                        // Collect all survey items; we'll take top 4 per category below
                        const winningRows = rows.filter((r) => (r.times_checked_good ?? 0) > 0).sort((a, b) => (b.times_checked_good ?? 0) - (a.times_checked_good ?? 0));
                        winningRows.forEach((r) => winningSurvey.push({ checklistTypeDisplay: typeDisplay, topItemText: (r.item_text || `Item ${r.checklist_item_id}`).trim(), good: r.times_checked_good ?? 0, key: `win-${r.checklist_item_id}` }));
                        const losingRows = rows.filter((r) => (r.times_not_checked_bad ?? 0) > 0).sort((a, b) => (b.times_not_checked_bad ?? 0) - (a.times_not_checked_bad ?? 0));
                        losingRows.forEach((r) => losingSurvey.push({ checklistTypeDisplay: typeDisplay, topItemText: (r.item_text || `Item ${r.checklist_item_id}`).trim(), bad: r.times_not_checked_bad ?? 0, key: `lose-${r.checklist_item_id}` }));
                      });
                      const displayWinningSurvey = [...winningSurvey].sort((a, b) => b.good - a.good).slice(0, 4);
                      const displayLosingSurvey = [...losingSurvey].sort((a, b) => b.bad - a.bad).slice(0, 4);
                      const hasSurveyInsights = displayWinningSurvey.length > 0 || displayLosingSurvey.length > 0;
                      if (!hasSurveyInsights) return null;
                      return (
                        <div style={{ marginTop: "24px", paddingTop: "20px", borderTop: "1px solid var(--border-color)" }}>
                          <h4 style={{ fontSize: "14px", fontWeight: "600", color: "var(--text-primary)", marginBottom: "12px" }}>
                            Survey Insights
                          </h4>
                          <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: "0 0 12px 0", lineHeight: 1.3 }}>
                            Survey values that were good for winning trades and bad for losing trades (from journal entries).
                          </p>
                          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                            {displayWinningSurvey.length > 0 && (
                              <div>
                                <div style={{ fontSize: "10px", fontWeight: "600", color: "var(--success, #22c55e)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>These values were good for winning trades</div>
                                <div style={{ display: "grid", gap: "6px" }}>
                                  {displayWinningSurvey.slice(0, 4).map(({ checklistTypeDisplay, topItemText, good, key }) => (
                                    <div key={key} style={{ padding: "6px 8px", borderRadius: "4px", backgroundColor: "var(--bg-tertiary)", borderLeft: "3px solid var(--success, #22c55e)", minHeight: "44px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                                      <span style={{ fontSize: "10px", color: "var(--text-secondary)", display: "block", marginBottom: "2px" }}>{checklistTypeDisplay}</span>
                                      <span style={{ fontSize: "12px", color: "var(--text-primary)", fontWeight: "500" }}>{topItemText === EMPTY_CUSTOM_CHECKLIST_PLACEHOLDER ? "—" : topItemText}</span>
                                      <span style={{ fontSize: "11px", color: "var(--text-secondary)", marginLeft: "6px" }}>({good} trades)</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {displayLosingSurvey.length > 0 && (
                              <div>
                                <div style={{ fontSize: "10px", fontWeight: "600", color: "var(--danger, #ef4444)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>These values were bad for losing trades</div>
                                <div style={{ display: "grid", gap: "6px" }}>
                                  {displayLosingSurvey.slice(0, 4).map(({ checklistTypeDisplay, topItemText, bad, key }) => (
                                    <div key={key} style={{ padding: "6px 8px", borderRadius: "4px", backgroundColor: "var(--bg-tertiary)", borderLeft: "3px solid var(--danger, #ef4444)", minHeight: "44px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                                      <span style={{ fontSize: "10px", color: "var(--text-secondary)", display: "block", marginBottom: "2px" }}>{checklistTypeDisplay}</span>
                                      <span style={{ fontSize: "12px", color: "var(--text-primary)", fontWeight: "500" }}>{topItemText === EMPTY_CUSTOM_CHECKLIST_PLACEHOLDER ? "—" : topItemText}</span>
                                      <span style={{ fontSize: "11px", color: "var(--text-secondary)", marginLeft: "6px" }}>({bad} losing)</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                  )}
                  </>
                );
              })()}
            </div>
          </div>
      )}

      {/* Right Panel - Empty State (Strategies Overview) */}
      {!selectedStrategyData && !isCreating && (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            backgroundColor: "var(--bg-primary)",
            padding: "24px",
            overflow: "auto",
          }}
        >
          {dataMode === "sandbox" && (
            <p style={{ margin: "0 0 16px 0", padding: "12px 16px", fontSize: "14px", fontWeight: "600", color: "var(--accent)", backgroundColor: "color-mix(in srgb, var(--accent) 14%, transparent)", border: "2px solid var(--accent)", borderRadius: "8px" }}>
              Demo mode — you are viewing demo data only.
            </p>
          )}
          {dataMode === "paper" && (
            <p style={{ margin: "0 0 16px 0", padding: "12px 16px", fontSize: "14px", fontWeight: "600", color: "var(--accent)", backgroundColor: "color-mix(in srgb, var(--accent) 14%, transparent)", border: "2px solid var(--accent)", borderRadius: "8px" }}>
              Paper mode — you are viewing paper trades only.
            </p>
          )}
          <div
            style={{
              border: "1px solid var(--border-color)",
              borderRadius: "8px",
              padding: "20px",
              marginBottom: "24px",
              backgroundColor: "var(--bg-secondary)",
            }}
          >
            <h2 style={{ fontSize: "20px", fontWeight: "600", marginBottom: "12px", color: "var(--text-primary)" }}>
              Strategies Overview
            </h2>
            <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "16px" }}>
              Review your strategies at a glance. Use this to decide which playbooks to refine, retire, or double‑down on.
            </p>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "10px",
                marginBottom: "16px",
              }}
            >
              <input
                type="text"
                placeholder="Search strategy name or description..."
                value={strategyFilterText}
                onChange={(e) => setStrategyFilterText(e.target.value)}
                style={{
                  flex: "1 1 220px",
                  minWidth: "180px",
                  padding: "8px 10px",
                  backgroundColor: "var(--bg-primary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px",
                  color: "var(--text-primary)",
                  fontSize: "13px",
                }}
              />
              <div ref={overviewFilterDropdownRef} style={{ position: "relative", flex: "0 0 auto" }}>
                <button
                  type="button"
                  onClick={() => setOverviewFilterDropdownOpen((o) => !o)}
                  style={{
                    padding: "8px 10px",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    minWidth: "180px",
                    justifyContent: "space-between",
                    backgroundColor: "var(--bg-primary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "6px",
                    color: "var(--text-primary)",
                    fontSize: "13px",
                    cursor: "pointer",
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {overviewFilterStrategyIds.length === 0
                      ? "All strategies"
                      : overviewFilterStrategyIds.length === 1
                        ? strategies.find((s) => s.id === overviewFilterStrategyIds[0])?.name ?? "1 strategy"
                        : `${overviewFilterStrategyIds.length} strategies`}
                  </span>
                  <ChevronDown size={14} style={{ flexShrink: 0, opacity: overviewFilterDropdownOpen ? 0.7 : 0.5 }} />
                </button>
                {overviewFilterDropdownOpen && (
                  <div
                    style={{
                      position: "absolute",
                      top: "100%",
                      left: 0,
                      marginTop: "4px",
                      minWidth: "220px",
                      maxHeight: "280px",
                      overflowY: "auto",
                      backgroundColor: "var(--bg-secondary)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "8px",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                      zIndex: 100,
                      padding: "8px",
                    }}
                  >
                    <div style={{ display: "flex", gap: "8px", marginBottom: "8px", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        onClick={() => setOverviewFilterStrategyIds([])}
                        style={{
                          fontSize: "11px",
                          padding: "4px 8px",
                          color: "var(--text-secondary)",
                          background: "transparent",
                          border: "1px solid var(--border-color)",
                          borderRadius: "4px",
                          cursor: "pointer",
                        }}
                      >
                        Clear
                      </button>
                      <button
                        type="button"
                        onClick={() => setOverviewFilterStrategyIds(strategies.map((s) => s.id!).filter(Boolean))}
                        style={{
                          fontSize: "11px",
                          padding: "4px 8px",
                          color: "var(--text-secondary)",
                          background: "transparent",
                          border: "1px solid var(--border-color)",
                          borderRadius: "4px",
                          cursor: "pointer",
                        }}
                      >
                        Select all
                      </button>
                    </div>
                    {strategies.map((s) => {
                      if (s.id == null) return null;
                      const checked = overviewFilterStrategyIds.includes(s.id);
                      return (
                        <label
                          key={s.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            padding: "6px 8px",
                            borderRadius: "6px",
                            cursor: "pointer",
                            fontSize: "13px",
                            color: "var(--text-primary)",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setOverviewFilterStrategyIds((prev) =>
                                prev.includes(s.id!)
                                  ? prev.filter((id) => id !== s.id)
                                  : [...prev, s.id!]
                              );
                            }}
                          />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</span>
                        </label>
                      );
                    })}
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "8px 8px 4px 8px",
                        marginTop: "8px",
                        borderTop: "1px solid var(--border-color)",
                        cursor: "pointer",
                        fontSize: "12px",
                        color: "var(--text-secondary)",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={strategyOverviewOnlyWithTrades}
                        onChange={(e) => setStrategyOverviewOnlyWithTrades(e.target.checked)}
                      />
                      Only show strategies with trades
                    </label>
                  </div>
                )}
              </div>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                gap: "12px",
                marginBottom: "20px",
              }}
            >
              <div style={{ padding: "12px", borderRadius: "6px", backgroundColor: "var(--bg-tertiary)" }}>
                <div style={{ fontSize: "11px", textTransform: "uppercase", color: "var(--text-secondary)", marginBottom: "4px" }}>
                  Strategies
                </div>
                <div style={{ fontSize: "20px", fontWeight: "600" }}>{strategiesOverviewStats.totalStrategies}</div>
              </div>
              <div style={{ padding: "12px", borderRadius: "6px", backgroundColor: "var(--bg-tertiary)" }}>
                <div style={{ fontSize: "11px", textTransform: "uppercase", color: "var(--text-secondary)", marginBottom: "4px" }}>
                  With trades
                </div>
                <div style={{ fontSize: "20px", fontWeight: "600" }}>{strategiesOverviewStats.withTrades}</div>
              </div>
              <div style={{ padding: "12px", borderRadius: "6px", backgroundColor: "var(--bg-tertiary)" }}>
                <div style={{ fontSize: "11px", textTransform: "uppercase", color: "var(--text-secondary)", marginBottom: "4px" }}>
                  Total P&amp;L
                </div>
                <div
                  style={{
                    fontSize: "20px",
                    fontWeight: "600",
                    color: strategiesOverviewStats.totalPnL >= 0 ? "var(--profit)" : "var(--loss)",
                  }}
                >
                  {strategiesOverviewStats.totalPnL === 0 ? "$0" : `$${strategiesOverviewStats.totalPnL.toFixed(0)}`}
                </div>
              </div>
            </div>
            {strategiesOverviewStats.bestWinRateName && (
              <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "12px" }}>
                Best win rate:{" "}
                <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                  {strategiesOverviewStats.bestWinRateName} ({strategiesOverviewStats.bestWinRate.toFixed(1)}%)
                </span>
              </div>
            )}
            <div style={{ height: 260 }}>
              {(() => {
                if (strategyOverviewTab === "checklist_usage") {
                  if (overviewChecklistUsageChartData.length === 0) {
                    return (
                      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)", fontSize: "13px", textAlign: "center" }}>
                        No checklist usage in journal entries yet. Use checklists in journals to see usage by type.
                      </div>
                    );
                  }
                  return (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={overviewChecklistUsageChartData} margin={OVERVIEW_CHART_MARGIN}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                        <XAxis dataKey="name" stroke="var(--text-secondary)" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} height={56} interval={0} />
                        <YAxis stroke="var(--text-secondary)" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} allowDecimals={false} />
                        <Tooltip cursor={{ fill: "rgba(255,255,255,0.02)" }} contentStyle={{ backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: "6px", fontSize: "11px", color: "var(--text-primary)" }} formatter={(value: any) => [value, "Times used"]} />
                        <Bar dataKey="count" fill="var(--accent)" fillOpacity={CHART_BAR_FILL_OPACITY} stroke="var(--accent)" strokeWidth={1.6} activeBar={{ fill: "var(--accent)", fillOpacity: 0.8, stroke: "var(--accent)", strokeWidth: 2 }} radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  );
                }
                if (strategyOverviewTab === "profitable_trades") {
                  if (overviewProfitableTradesChartData.length === 0) {
                    return (
                      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)", fontSize: "13px", textAlign: "center" }}>
                        {strategies.length === 0 ? "Create a strategy to see overview stats." : "No trade stats yet. Link trades to strategies to see winning vs losing by strategy."}
                      </div>
                    );
                  }
                  return (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={overviewProfitableTradesChartData} margin={OVERVIEW_CHART_MARGIN}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                        <XAxis dataKey="name" stroke="var(--text-secondary)" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} height={56} interval={0} />
                        <YAxis stroke="var(--text-secondary)" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} allowDecimals={false} />
                        <Tooltip cursor={{ fill: "rgba(255,255,255,0.02)" }} contentStyle={{ backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: "6px", fontSize: "11px", color: "var(--text-primary)" }} formatter={(value: any) => [value, ""]} labelFormatter={(label: string) => `${label} (Winning / Losing)`} />
                        <Bar dataKey="winning" fill="var(--success, #22c55e)" fillOpacity={CHART_BAR_FILL_OPACITY} stroke="var(--success, #22c55e)" strokeWidth={1} stackId="trades" radius={[0, 0, 0, 0]} />
                        <Bar dataKey="losing" fill="var(--danger, #ef4444)" fillOpacity={CHART_BAR_FILL_OPACITY} stroke="var(--danger, #ef4444)" strokeWidth={1} stackId="trades" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  );
                }
                if (strategiesOverviewChartData.length === 0) {
                  return (
                    <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)", fontSize: "13px", textAlign: "center" }}>
                      {strategies.length === 0 ? "Create a strategy to see overview stats." : "No trade stats yet. Link trades to strategies to see distributions."}
                    </div>
                  );
                }
                const useBrush = strategiesOverviewChartData.length > BRUSH_MIN_POINTS;
                const start = useBrush && strategyOverviewBrushEnd > 0 ? Math.min(strategyOverviewBrushStart, strategiesOverviewChartData.length - 1) : 0;
                const end = useBrush && strategyOverviewBrushEnd > 0 ? Math.min(strategiesOverviewChartData.length - 1, Math.max(start, strategyOverviewBrushEnd)) : Math.max(0, strategiesOverviewChartData.length - 1);
                return (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={strategiesOverviewChartData} margin={OVERVIEW_CHART_MARGIN}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                      <XAxis dataKey="name" stroke="var(--text-secondary)" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} height={56} interval={strategiesOverviewChartData.length > 20 ? Math.floor(strategiesOverviewChartData.length / 10) : 0} />
                      <YAxis stroke="var(--text-secondary)" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} tickFormatter={(v: number) => strategyOverviewTab === "win_rate" ? `${v.toFixed(0)}%` : strategyOverviewTab === "trades" ? v.toString() : `$${v.toFixed(0)}`} />
                      <Tooltip cursor={{ fill: "rgba(255,255,255,0.02)" }} contentStyle={{ backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: "6px", fontSize: "11px", color: "var(--text-primary)" }} formatter={(value: any) => { if (strategyOverviewTab === "win_rate") return [`${value.toFixed(1)}%`, "Win rate"]; if (strategyOverviewTab === "trades") return [value, "Trades"]; return [`$${value.toFixed(2)}`, "P&L"]; }} />
                      <Bar dataKey={strategyOverviewTab === "pnl" ? "pnl" : strategyOverviewTab === "win_rate" ? "win_rate" : "trades"} fill="var(--accent)" fillOpacity={CHART_BAR_FILL_OPACITY} stroke="var(--accent)" strokeWidth={1.6} activeBar={{ fill: "var(--accent)", fillOpacity: 0.8, stroke: "var(--accent)", strokeWidth: 2 }} radius={[4, 4, 0, 0]} />
                      {useBrush && <Brush dataKey="name" height={36} stroke="var(--border-color)" fill="var(--bg-tertiary)" startIndex={start} endIndex={end} onDragEnd={(r: { startIndex?: number; endIndex?: number }) => { if (r.startIndex != null && r.endIndex != null) { setStrategyOverviewBrushStart(r.startIndex); setStrategyOverviewBrushEnd(r.endIndex); } }} />}
                    </BarChart>
                  </ResponsiveContainer>
                );
              })()}
            </div>
            <div
              style={{
                marginTop: "12px",
                display: "flex",
                flexWrap: "wrap",
                gap: "6px",
              }}
            >
              {[
                { id: "pnl" as const, label: "P&L" },
                { id: "win_rate" as const, label: "Win rate" },
                { id: "trades" as const, label: "Trades" },
                { id: "checklist_usage" as const, label: "Checklist usage" },
                { id: "profitable_trades" as const, label: "Profitable trades" },
              ].map((tab) => {
                const isActive = strategyOverviewTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setStrategyOverviewTab(tab.id)}
                    style={{
                      padding: "6px 12px",
                      fontSize: "12px",
                      borderRadius: "999px",
                      border: "none",
                      backgroundColor: isActive ? "var(--accent)" : "transparent",
                      color: isActive ? "#ffffff" : "var(--text-secondary)",
                      cursor: "pointer",
                    }}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Specific Strategy Metrics: Survey metrics + Checklist item metrics + Checklists and Survey insights */}
            {(overviewCustomMetricsByStrategy.size > 0 || overviewChecklistItemMetricsByStrategy.size > 0 || overviewChecklistByOutcomePerStrategy.length > 0 || strategies.some((s) => s.id != null)) && (
              <div style={{ marginTop: "20px" }}>
                <h2
                  style={{
                    fontSize: "16px",
                    fontWeight: "700",
                    margin: "0 0 12px 0",
                    color: "var(--text-primary)",
                  }}
                >
                  Specific Strategy Metrics
                </h2>
                <p style={{ fontSize: "11px", color: "var(--text-secondary)", margin: "0 0 12px 0" }}>
                  Survey metrics, checklist item metrics, and checklists and survey insights are filtered by the Strategies dropdown at the top of the page.
                </p>
                {(overviewCustomMetricsByStrategy.size > 0 || overviewChecklistItemMetricsByStrategy.size > 0 || overviewChecklistByOutcomePerStrategy.length > 0) ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    {(() => {
                      const filteredStrategies = strategies.filter((s) => s.id != null && (overviewFilterStrategyIds.length === 0 || overviewFilterStrategyIds.includes(s.id)) && (overviewCustomMetricsByStrategy.has(s.id) || overviewChecklistItemMetricsByStrategy.has(s.id) || overviewChecklistByOutcomePerStrategy.some((r) => r.strategyId === s.id)));
                      const isSurveyType = (display: string) => display.toLowerCase().startsWith("survey");
                      return filteredStrategies.map((s) => {
                        const metrics = overviewCustomMetricsByStrategy.get(s.id!) ?? [];
                        const itemMetrics = overviewChecklistItemMetricsByStrategy.get(s.id!) ?? [];
                        const insightItems = overviewChecklistByOutcomePerStrategy.find((r) => r.strategyId === s.id!)?.items ?? [];
                        const insightByType = new Map<string, ChecklistItemMetricByOutcomeRow[]>();
                        insightItems.forEach((row) => {
                          const type = row.checklist_type || "other";
                          if (!insightByType.has(type)) insightByType.set(type, []);
                          insightByType.get(type)!.push(row);
                        });
                        const winningPerType: Array<{ checklistTypeDisplay: string; topItemText: string; good: number }> = [];
                        const notClickedLosingPerType: Array<{ checklistTypeDisplay: string; topItemText: string; bad: number }> = [];
                        insightByType.forEach((rows, type) => {
                          const typeDisplay = type.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
                          const surveyType = isSurveyType(typeDisplay);
                          if (surveyType) {
                            const winningRows = rows.filter((r) => (r.times_checked_good ?? 0) > 0).sort((a, b) => (b.times_checked_good ?? 0) - (a.times_checked_good ?? 0));
                            winningRows.forEach((r) => winningPerType.push({ checklistTypeDisplay: typeDisplay, topItemText: (r.item_text || `Item ${r.checklist_item_id}`).trim(), good: r.times_checked_good ?? 0 }));
                            const losingRows = rows.filter((r) => (r.times_not_checked_bad ?? 0) > 0).sort((a, b) => (b.times_not_checked_bad ?? 0) - (a.times_not_checked_bad ?? 0));
                            losingRows.forEach((r) => notClickedLosingPerType.push({ checklistTypeDisplay: typeDisplay, topItemText: (r.item_text || `Item ${r.checklist_item_id}`).trim(), bad: r.times_not_checked_bad ?? 0 }));
                          } else {
                            const topWinning = rows.reduce((best, r) => ((r.times_checked_good ?? 0) > (best.times_checked_good ?? 0) ? r : best), rows[0]);
                            if (topWinning && (topWinning.times_checked_good ?? 0) > 0) winningPerType.push({ checklistTypeDisplay: typeDisplay, topItemText: (topWinning.item_text || `Item ${topWinning.checklist_item_id}`).trim(), good: topWinning.times_checked_good ?? 0 });
                            const topNotClicked = rows.reduce((best, r) => ((r.times_not_checked_bad ?? 0) > (best.times_not_checked_bad ?? 0) ? r : best), rows[0]);
                            if (topNotClicked && (topNotClicked.times_not_checked_bad ?? 0) > 0) notClickedLosingPerType.push({ checklistTypeDisplay: typeDisplay, topItemText: (topNotClicked.item_text || `Item ${topNotClicked.checklist_item_id}`).trim(), bad: topNotClicked.times_not_checked_bad ?? 0 });
                          }
                        });
                        const winningChecklist = winningPerType.filter((x) => !isSurveyType(x.checklistTypeDisplay));
                        const winningSurvey = winningPerType.filter((x) => isSurveyType(x.checklistTypeDisplay));
                        const losingChecklist = notClickedLosingPerType.filter((x) => !isSurveyType(x.checklistTypeDisplay));
                        const losingSurvey = notClickedLosingPerType.filter((x) => isSurveyType(x.checklistTypeDisplay));
                        const TOP_INSIGHTS = 4;
                        const displayWinningChecklist = [...winningChecklist].sort((a, b) => b.good - a.good).slice(0, TOP_INSIGHTS);
                        const displayLosingChecklist = [...losingChecklist].sort((a, b) => b.bad - a.bad).slice(0, TOP_INSIGHTS);
                        const displayWinningSurvey = [...winningSurvey].sort((a, b) => b.good - a.good).slice(0, TOP_INSIGHTS);
                        const displayLosingSurvey = [...losingSurvey].sort((a, b) => b.bad - a.bad).slice(0, TOP_INSIGHTS);
                        const hasInsights = winningPerType.length > 0 || notClickedLosingPerType.length > 0;
                        const showInsightsBlock = hasInsights || metrics.length > 0;
                        return (
                          <div
                            key={s.id}
                            style={{
                              padding: "12px 14px",
                              borderRadius: "8px",
                              border: "1px solid var(--border-color)",
                              backgroundColor: "var(--bg-tertiary)",
                            }}
                          >
                            <div
                              style={{
                                fontSize: "13px",
                                fontWeight: "600",
                                color: "var(--text-primary)",
                                marginBottom: "8px",
                              }}
                            >
                              {s.name}
                            </div>
                            {itemMetrics.length > 0 && (
                              <>
                                <div style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.02em" }}>
                                  Checklist & survey item metrics
                                </div>
                                <div style={{ overflowX: "auto", marginBottom: (hasInsights || metrics.length > 0) ? "12px" : 0 }}>
                                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                                    <thead>
                                      <tr style={{ borderBottom: "1px solid var(--border-color)" }}>
                                        <th style={{ textAlign: "left", padding: "6px", color: "var(--text-secondary)", fontWeight: "600" }}>Item</th>
                                        <th style={{ textAlign: "right", padding: "6px", color: "var(--text-secondary)", fontWeight: "600" }}>#</th>
                                        <th style={{ textAlign: "right", padding: "6px", color: "var(--text-secondary)", fontWeight: "600" }}>Avg</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {itemMetrics.filter((row) => row.item_text !== EMPTY_CUSTOM_CHECKLIST_PLACEHOLDER).map((row) => (
                                        <tr key={row.checklist_item_id} style={{ borderBottom: "1px solid var(--border-color)" }}>
                                          <td style={{ padding: "6px", color: "var(--text-primary)" }}>{row.item_text}</td>
                                          <td style={{ padding: "6px", textAlign: "right", color: "var(--text-secondary)" }}>{row.times_checked}</td>
                                          <td style={{ padding: "6px", textAlign: "right", color: row.avg_performance != null && row.avg_performance < 0 ? "var(--loss)" : "var(--text-primary)" }}>
                                            {formatChecklistAvgPerformance(row.avg_performance, row.performance_kind)}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </>
                            )}
                            {showInsightsBlock && (hasInsights || metrics.length > 0) && (
                              <div
                                style={{
                                  padding: "12px",
                                  borderRadius: "6px",
                                  backgroundColor: "var(--bg-primary)",
                                  border: "1px solid var(--border-color)",
                                }}
                              >
                                <div style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-primary)", marginBottom: "2px" }}>
                                  Checklists and Survey Insights
                                </div>
                                <p style={{ fontSize: "11px", color: "var(--text-secondary)", margin: "0 0 10px 0", lineHeight: 1.3 }}>
                                  Checklist and survey items: top in winning trades and often skipped in losing trades.{filteredStrategies.length > 1 ? " For this strategy." : ""}
                                </p>
                                {/* Key stats: checklist stats on the left, Survey Insights on the right */}
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px", marginBottom: "12px" }}>
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                                    {winningPerType.length > 0 && (
                                      <div
                                        style={{
                                          padding: "6px 10px",
                                          borderRadius: "6px",
                                          backgroundColor: "rgba(34, 197, 94, 0.12)",
                                          border: "1px solid rgba(34, 197, 94, 0.35)",
                                          minWidth: "60px",
                                          textAlign: "center",
                                        }}
                                      >
                                        <div style={{ fontSize: "9px", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: "2px" }}>Winning</div>
                                        <div style={{ fontSize: "16px", fontWeight: "700", color: "var(--success, #22c55e)" }}>
                                          {winningPerType.reduce((sum, x) => sum + x.good, 0)}
                                        </div>
                                        <div style={{ fontSize: "9px", color: "var(--text-secondary)" }}>trades</div>
                                      </div>
                                    )}
                                    {notClickedLosingPerType.length > 0 && (
                                      <div
                                        style={{
                                          padding: "6px 10px",
                                          borderRadius: "6px",
                                          backgroundColor: "rgba(239, 68, 68, 0.12)",
                                          border: "1px solid rgba(239, 68, 68, 0.35)",
                                          minWidth: "60px",
                                          textAlign: "center",
                                        }}
                                      >
                                        <div style={{ fontSize: "9px", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: "2px" }}>Skipped</div>
                                        <div style={{ fontSize: "16px", fontWeight: "700", color: "var(--danger, #ef4444)" }}>
                                          {notClickedLosingPerType.reduce((sum, x) => sum + x.bad, 0)}
                                        </div>
                                        <div style={{ fontSize: "9px", color: "var(--text-secondary)" }}>in losing</div>
                                      </div>
                                    )}
                                    {itemMetrics.length > 0 && (
                                      <div
                                        style={{
                                          padding: "6px 10px",
                                          borderRadius: "6px",
                                          backgroundColor: "var(--bg-tertiary)",
                                          border: "1px solid var(--border-color)",
                                          minWidth: "60px",
                                          textAlign: "center",
                                        }}
                                      >
                                        <div style={{ fontSize: "9px", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: "2px" }}>Items</div>
                                        <div style={{ fontSize: "16px", fontWeight: "700", color: "var(--text-primary)" }}>{itemMetrics.filter((r) => r.item_text !== EMPTY_CUSTOM_CHECKLIST_PLACEHOLDER).length}</div>
                                        <div style={{ fontSize: "9px", color: "var(--text-secondary)" }}>tracked</div>
                                      </div>
                                    )}
                                  </div>
                                  {(metrics.length > 0 || (showInsightsBlock && (displayWinningSurvey.length > 0 || displayLosingSurvey.length > 0))) && (
                                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" }}>
                                      <div style={{ fontSize: "10px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Survey Insights</div>
                                      {metrics.length > 0 ? (
                                        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "flex-end" }}>
                                          {metrics.map((m) => (
                                            <div
                                              key={m.id}
                                              style={{
                                                padding: "6px 10px",
                                                borderRadius: "6px",
                                                backgroundColor: "var(--bg-tertiary)",
                                                border: "1px solid var(--border-color)",
                                                minWidth: "60px",
                                                textAlign: "center",
                                              }}
                                            >
                                              <div style={{ fontSize: "9px", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: "2px", maxWidth: "90px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={m.name}>{m.name}</div>
                                              <div style={{ fontSize: "16px", fontWeight: "700", color: m.computed_value != null ? getMetricColorFromScale((m.computed_value - 1) / 4, m.color_scale) : "var(--text-primary)" }}>
                                                {m.computed_value != null ? m.computed_value.toFixed(2) : "—"}
                                              </div>
                                              {m.description && (
                                                <div style={{ fontSize: "9px", color: "var(--text-secondary)", marginTop: "2px", maxWidth: "90px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={m.description}>{m.description}</div>
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                      ) : (
                                        <div style={{ fontSize: "11px", color: "var(--text-secondary)", textAlign: "right", maxWidth: "200px" }}>
                                          See values good for winning trades and bad for losing trades in the columns below.
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                                {/* Left: checklist insights. Right: survey item insights (same card style) */}
                                <div style={{ display: "flex", gap: "20px", alignItems: "flex-start", flexWrap: "wrap" }}>
                                  <div style={{ flex: "1 1 280px", minWidth: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
                                    {displayWinningChecklist.length > 0 && (
                                      <div>
                                        <div style={{ fontSize: "10px", fontWeight: "600", color: "var(--success, #22c55e)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>
                                          Winning trades (checklist)
                                        </div>
                                        <div style={{ display: "grid", gap: "6px" }}>
                                          {displayWinningChecklist.slice(0, 4).map(({ checklistTypeDisplay, topItemText, good }, idx) => (
                                            <div
                                              key={`win-c-${s.id}-${idx}-${topItemText}`}
                                              style={{
                                                padding: "6px 8px",
                                                borderRadius: "4px",
                                                backgroundColor: "var(--bg-tertiary)",
                                                borderLeft: "3px solid var(--success, #22c55e)",
                                                minHeight: "44px",
                                                display: "flex",
                                                flexDirection: "column",
                                                justifyContent: "center",
                                              }}
                                            >
                                              <span style={{ fontSize: "10px", color: "var(--text-secondary)", display: "block", marginBottom: "2px" }}>{checklistTypeDisplay}</span>
                                              <span style={{ fontSize: "12px", color: "var(--text-primary)", fontWeight: "500" }}>{topItemText === EMPTY_CUSTOM_CHECKLIST_PLACEHOLDER ? "—" : topItemText}</span>
                                              <span style={{ fontSize: "11px", color: "var(--text-secondary)", marginLeft: "6px" }}>({good} trades)</span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    {displayLosingChecklist.length > 0 && (
                                      <div>
                                        <div style={{ fontSize: "10px", fontWeight: "600", color: "var(--danger, #ef4444)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>
                                          Often skipped in losing trades (checklist)
                                        </div>
                                        <div style={{ display: "grid", gap: "6px" }}>
                                          {displayLosingChecklist.slice(0, 4).map(({ checklistTypeDisplay, topItemText, bad }, idx) => (
                                            <div
                                              key={`lose-c-${s.id}-${idx}-${topItemText}`}
                                              style={{
                                                padding: "6px 8px",
                                                borderRadius: "4px",
                                                backgroundColor: "var(--bg-tertiary)",
                                                borderLeft: "3px solid var(--danger, #ef4444)",
                                                minHeight: "44px",
                                                display: "flex",
                                                flexDirection: "column",
                                                justifyContent: "center",
                                              }}
                                            >
                                              <span style={{ fontSize: "10px", color: "var(--text-secondary)", display: "block", marginBottom: "2px" }}>{checklistTypeDisplay}</span>
                                              <span style={{ fontSize: "12px", color: "var(--text-primary)", fontWeight: "500" }}>{topItemText === EMPTY_CUSTOM_CHECKLIST_PLACEHOLDER ? "—" : topItemText}</span>
                                              <span style={{ fontSize: "11px", color: "var(--text-secondary)", marginLeft: "6px" }}>({bad} losing)</span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                  <div style={{ flex: "1 1 280px", minWidth: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
                                    {displayWinningSurvey.length > 0 && (
                                      <div>
                                        <div style={{ fontSize: "10px", fontWeight: "600", color: "var(--success, #22c55e)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>
                                          These values were good for winning trades
                                        </div>
                                        <div style={{ display: "grid", gap: "6px" }}>
                                          {displayWinningSurvey.slice(0, 4).map((row, idx) => (
                                            <div
                                              key={`win-s-${s.id}-${idx}-${row.topItemText}`}
                                              style={{ padding: "6px 8px", borderRadius: "4px", backgroundColor: "var(--bg-tertiary)", borderLeft: "3px solid var(--success, #22c55e)", minHeight: "44px", display: "flex", flexDirection: "column", justifyContent: "center" }}
                                            >
                                              <span style={{ fontSize: "10px", color: "var(--text-secondary)", display: "block", marginBottom: "2px" }}>{row.checklistTypeDisplay}</span>
                                              <span style={{ fontSize: "12px", color: "var(--text-primary)", fontWeight: "500" }}>{row.topItemText === EMPTY_CUSTOM_CHECKLIST_PLACEHOLDER ? "—" : row.topItemText}</span>
                                              <span style={{ fontSize: "11px", color: "var(--text-secondary)", marginLeft: "6px" }}>({row.good} trades)</span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    {displayLosingSurvey.length > 0 && (
                                      <div>
                                        <div style={{ fontSize: "10px", fontWeight: "600", color: "var(--danger, #ef4444)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>
                                          These values were bad for losing trades
                                        </div>
                                        <div style={{ display: "grid", gap: "6px" }}>
                                          {displayLosingSurvey.slice(0, 4).map((row, idx) => (
                                            <div
                                              key={`lose-s-${s.id}-${idx}-${row.topItemText}`}
                                              style={{ padding: "6px 8px", borderRadius: "4px", backgroundColor: "var(--bg-tertiary)", borderLeft: "3px solid var(--danger, #ef4444)", minHeight: "44px", display: "flex", flexDirection: "column", justifyContent: "center" }}
                                            >
                                              <span style={{ fontSize: "10px", color: "var(--text-secondary)", display: "block", marginBottom: "2px" }}>{row.checklistTypeDisplay}</span>
                                              <span style={{ fontSize: "12px", color: "var(--text-primary)", fontWeight: "500" }}>{row.topItemText === EMPTY_CUSTOM_CHECKLIST_PLACEHOLDER ? "—" : row.topItemText}</span>
                                              <span style={{ fontSize: "11px", color: "var(--text-secondary)", marginLeft: "6px" }}>({row.bad} losing)</span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      });
                    })()}
                  </div>
                ) : (
                  <div style={{ padding: "16px", borderRadius: "8px", border: "1px solid var(--border-color)", backgroundColor: "var(--bg-tertiary)", minHeight: "80px" }}>
                    <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: 0 }}>
                    {overviewCustomMetricsByStrategy.size === 0 && overviewChecklistItemMetricsByStrategy.size === 0 && overviewChecklistByOutcomePerStrategy.length === 0
                      ? "No survey metrics, checklist item metrics, or checklist insights yet. Add metrics in a strategy’s Metrics tab."
                      : "Select one or more strategies in the Strategies dropdown at the top to view metrics."}
                    </p>
                  </div>
                )}
              </div>
            )}

          </div>

          <div
            style={{
              borderRadius: "8px",
              border: "1px solid var(--border-color)",
              backgroundColor: "var(--bg-secondary)",
              padding: "16px 20px",
            }}
          >
            <h3
              style={{
                fontSize: "14px",
                fontWeight: "600",
                marginBottom: "10px",
                color: "var(--text-primary)",
              }}
            >
              Recent Strategies
            </h3>
            {filteredStrategies.length === 0 ? (
              <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
                {strategies.length === 0 ? "No strategies yet. Create one to get started." : "No strategies match the current filters."}
              </p>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                  maxHeight: 260,
                  overflowY: "auto",
                }}
              >
                {filteredStrategies
                  .slice()
                  .sort((a, b) => {
                    const ad = a.created_at || "";
                    const bd = b.created_at || "";
                    return bd.localeCompare(ad);
                  })
                  .slice(0, 8)
                  .map((s) => {
                    const stats = s.id != null ? strategyStats.get(s.id) : undefined;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setSelectedStrategy(s.id!)}
                        style={{
                          textAlign: "left",
                          padding: "8px 10px",
                          borderRadius: "6px",
                          border: "1px solid var(--border-color)",
                          backgroundColor: "var(--bg-tertiary)",
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ fontSize: "13px", fontWeight: 500, color: "var(--text-primary)", marginBottom: "2px" }}>
                          {s.name}
                        </div>
                        <div style={{ fontSize: "11px", color: "var(--text-secondary)", display: "flex", justifyContent: "space-between" }}>
                          <span>{s.description || "No description"}</span>
                          {stats && stats.totalTrades > 0 && (
                            <span>
                              {stats.totalTrades} trades · {stats.winRate.toFixed(0)}% win
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
              </div>
            )}
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
                  const virtualId = isCreating ? -1 : (selectedStrategy ?? 0);
                  const defaultTypesList = ["daily_analysis", "daily_mantra", "entry", "take_profit"];
                  const currentMapForOrder = isCreating ? tempChecklists : (editingChecklists.get(selectedStrategy!) ?? checklists.get(selectedStrategy!) ?? new Map<string, ChecklistItem[]>());
                  const existingCustom = Array.from(currentMapForOrder.keys()).filter((t: string) => !defaultTypesList.includes(t) && t !== "survey");
                  const currentOrder = checklistTypeOrder.get(virtualId) ?? [...defaultTypesList, ...existingCustom];
                  const newOrder = newChecklistAtTop ? [typeName, ...currentOrder.filter((t: string) => t !== typeName)] : [...currentOrder.filter((t: string) => t !== typeName), typeName];
                  setChecklistTypeOrder((prev) => new Map(prev).set(virtualId, newOrder));
                  if (isCreating) {
                    setTempChecklists(addChecklistTypeToMap(tempChecklists, typeName, newChecklistAtTop));
                  } else if (isEditing && selectedStrategy) {
                    // Add to editingChecklists when editing
                    let currentChecklist: Map<string, ChecklistItem[]>;
                    if (editingChecklists.has(selectedStrategy)) {
                      currentChecklist = editingChecklists.get(selectedStrategy)!;
                    } else {
                      const existingChecklist = checklists.get(selectedStrategy) || new Map<string, ChecklistItem[]>();
                      currentChecklist = new Map<string, ChecklistItem[]>();
                      for (const [checklistType, items] of existingChecklist.entries()) {
                        currentChecklist.set(checklistType, items.map(item => ({ ...item })));
                      }
                      setEditingChecklists(new Map(editingChecklists.set(selectedStrategy, currentChecklist)));
                      if (!checklistEditHistory.has(selectedStrategy)) {
                        const originalCopy = new Map<string, ChecklistItem[]>();
                        for (const [checklistType, items] of existingChecklist.entries()) {
                          originalCopy.set(checklistType, items.map(item => ({ ...item })));
                        }
                        setChecklistEditHistory(new Map(checklistEditHistory.set(selectedStrategy, [originalCopy])));
                      }
                    }
                    const updatedChecklist = addChecklistTypeToMap(currentChecklist, typeName, newChecklistAtTop);
                    setEditingChecklists(new Map(editingChecklists.set(selectedStrategy, updatedChecklist)));
                    const history = checklistEditHistory.get(selectedStrategy) || [];
                    const newHistory = [...history, new Map(updatedChecklist)].slice(-10);
                    setChecklistEditHistory(new Map(checklistEditHistory.set(selectedStrategy, newHistory)));
                  } else if (selectedStrategy) {
                    const currentChecklist = checklists.get(selectedStrategy) || new Map<string, ChecklistItem[]>();
                    const updatedChecklist = addChecklistTypeToMap(currentChecklist, typeName, newChecklistAtTop);
                    setChecklists(new Map(checklists.set(selectedStrategy, updatedChecklist)));
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
                marginBottom: "12px",
                outline: "none",
              }}
            />
            <label style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "20px", cursor: "pointer", fontSize: "14px", color: "var(--text-secondary)" }}>
              <input
                type="checkbox"
                checked={newChecklistAtTop}
                onChange={(e) => setNewChecklistAtTop(e.target.checked)}
              />
              Add to top of checklists
            </label>
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
                    const virtualId = isCreating ? -1 : (selectedStrategy ?? 0);
                    const defaultTypesList = ["daily_analysis", "daily_mantra", "entry", "take_profit"];
                    const currentMapForOrder = isCreating ? tempChecklists : (editingChecklists.get(selectedStrategy!) ?? checklists.get(selectedStrategy!) ?? new Map<string, ChecklistItem[]>());
                    const existingCustom = Array.from(currentMapForOrder.keys()).filter((t: string) => !defaultTypesList.includes(t) && t !== "survey");
                    const currentOrder = checklistTypeOrder.get(virtualId) ?? [...defaultTypesList, ...existingCustom];
                    const newOrder = newChecklistAtTop ? [typeName, ...currentOrder.filter((t: string) => t !== typeName)] : [...currentOrder.filter((t: string) => t !== typeName), typeName];
                    setChecklistTypeOrder((prev) => new Map(prev).set(virtualId, newOrder));
                    if (isCreating) {
                      setTempChecklists(addChecklistTypeToMap(tempChecklists, typeName, newChecklistAtTop));
                    } else if (isEditing && selectedStrategy) {
                      let currentChecklist: Map<string, ChecklistItem[]>;
                      if (editingChecklists.has(selectedStrategy)) {
                        currentChecklist = editingChecklists.get(selectedStrategy)!;
                      } else {
                        const existingChecklist = checklists.get(selectedStrategy) || new Map<string, ChecklistItem[]>();
                        currentChecklist = new Map<string, ChecklistItem[]>();
                        for (const [checklistType, items] of existingChecklist.entries()) {
                          currentChecklist.set(checklistType, items.map(item => ({ ...item })));
                        }
                        setEditingChecklists(new Map(editingChecklists.set(selectedStrategy, currentChecklist)));
                        if (!checklistEditHistory.has(selectedStrategy)) {
                          const originalCopy = new Map<string, ChecklistItem[]>();
                          for (const [checklistType, items] of existingChecklist.entries()) {
                            originalCopy.set(checklistType, items.map(item => ({ ...item })));
                          }
                          setChecklistEditHistory(new Map(checklistEditHistory.set(selectedStrategy, [originalCopy])));
                        }
                      }
                      const updatedChecklist = addChecklistTypeToMap(currentChecklist, typeName, newChecklistAtTop);
                      setEditingChecklists(new Map(editingChecklists.set(selectedStrategy, updatedChecklist)));
                      const history = checklistEditHistory.get(selectedStrategy) || [];
                      const newHistory = [...history, new Map(updatedChecklist)].slice(-10);
                      setChecklistEditHistory(new Map(checklistEditHistory.set(selectedStrategy, newHistory)));
                    } else if (selectedStrategy) {
                      const currentChecklist = checklists.get(selectedStrategy) || new Map<string, ChecklistItem[]>();
                      const updatedChecklist = addChecklistTypeToMap(currentChecklist, typeName, newChecklistAtTop);
                      setChecklists(new Map(checklists.set(selectedStrategy, updatedChecklist)));
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

      {/* Add Survey Modal (Metrics tab) */}
      {showAddSurveyModal && (
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
          onClick={() => { setShowAddSurveyModal(false); setNewSurveyName(""); }}
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
            <h3 style={{ fontSize: "18px", fontWeight: "600", marginBottom: "16px", color: "var(--text-primary)" }}>
              Add survey
            </h3>
            <p style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "16px" }}>
              Enter a name for the new survey (e.g. Weekly Review, Pre-Market):
            </p>
            <input
              type="text"
              value={newSurveyName}
              onChange={(e) => setNewSurveyName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newSurveyName.trim()) {
                  const displayName = newSurveyName.trim();
                  const slug = displayName.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "") || "custom";
                  const typeName = "survey_" + slug;
                  const virtualId = isCreating ? -1 : (selectedStrategy ?? 0);
                  const currentMap = isCreating ? tempChecklists : (editingChecklists.get(selectedStrategy!) ?? checklists.get(selectedStrategy!) ?? new Map<string, ChecklistItem[]>());
                  if (currentMap.has(typeName)) {
                    setShowAddSurveyModal(false);
                    setNewSurveyName("");
                    return;
                  }
                  setChecklistTitles((prev) => {
                    const next = new Map(prev);
                    const strategyTitles = new Map(next.get(virtualId) || []);
                    strategyTitles.set(typeName, displayName);
                    next.set(virtualId, strategyTitles);
                    return next;
                  });
                  if (isCreating) {
                    setTempChecklists(addChecklistTypeToMap(tempChecklists, typeName, true));
                  } else if (isEditing && selectedStrategy) {
                    let currentChecklist: Map<string, ChecklistItem[]>;
                    if (editingChecklists.has(selectedStrategy)) {
                      currentChecklist = editingChecklists.get(selectedStrategy)!;
                    } else {
                      const existing = checklists.get(selectedStrategy) || new Map<string, ChecklistItem[]>();
                      currentChecklist = new Map(existing.entries());
                      setEditingChecklists(new Map(editingChecklists.set(selectedStrategy, currentChecklist)));
                      if (!checklistEditHistory.has(selectedStrategy)) {
                        const orig = new Map<string, ChecklistItem[]>();
                        for (const [k, v] of existing.entries()) orig.set(k, v.map((i) => ({ ...i })));
                        setChecklistEditHistory(new Map(checklistEditHistory.set(selectedStrategy, [orig])));
                      }
                    }
                    const updated = addChecklistTypeToMap(currentChecklist, typeName, true);
                    setEditingChecklists(new Map(editingChecklists.set(selectedStrategy, updated)));
                    const history = checklistEditHistory.get(selectedStrategy) || [];
                    setChecklistEditHistory(new Map(checklistEditHistory.set(selectedStrategy, [...history, new Map(updated)].slice(-10))));
                    const customSet = new Set(customChecklistTypes.get(selectedStrategy) || []);
                    customSet.add(typeName);
                    setCustomChecklistTypes(new Map(customChecklistTypes.set(selectedStrategy, customSet)));
                  } else if (selectedStrategy) {
                    const currentChecklist = checklists.get(selectedStrategy) || new Map<string, ChecklistItem[]>();
                    const updated = addChecklistTypeToMap(currentChecklist, typeName, true);
                    setChecklists(new Map(checklists.set(selectedStrategy, updated)));
                    const customSet = new Set(customChecklistTypes.get(selectedStrategy) || []);
                    customSet.add(typeName);
                    setCustomChecklistTypes(new Map(customChecklistTypes.set(selectedStrategy, customSet)));
                  }
                  setShowAddSurveyModal(false);
                  setNewSurveyName("");
                }
              }}
              placeholder="e.g. Weekly Review"
              style={{ width: "100%", padding: "10px 12px", borderRadius: "6px", border: "1px solid var(--border-color)", background: "var(--bg-primary)", color: "var(--text-primary)", marginBottom: "16px" }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              <button
                type="button"
                onClick={() => { setShowAddSurveyModal(false); setNewSurveyName(""); }}
                style={{ padding: "8px 16px", borderRadius: "6px", border: "1px solid var(--border-color)", background: "var(--bg-secondary)", color: "var(--text-primary)", cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!newSurveyName.trim()}
                onClick={() => {
                  if (!newSurveyName.trim()) return;
                  const displayName = newSurveyName.trim();
                  const slug = displayName.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "") || "custom";
                  const typeName = "survey_" + slug;
                  const virtualId = isCreating ? -1 : (selectedStrategy ?? 0);
                  const currentMap = isCreating ? tempChecklists : (editingChecklists.get(selectedStrategy!) ?? checklists.get(selectedStrategy!) ?? new Map<string, ChecklistItem[]>());
                  if (currentMap.has(typeName)) {
                    setShowAddSurveyModal(false);
                    setNewSurveyName("");
                    return;
                  }
                  setChecklistTitles((prev) => {
                    const next = new Map(prev);
                    const strategyTitles = new Map(next.get(virtualId) || []);
                    strategyTitles.set(typeName, displayName);
                    next.set(virtualId, strategyTitles);
                    return next;
                  });
                  if (isCreating) {
                    setTempChecklists(addChecklistTypeToMap(tempChecklists, typeName, true));
                  } else if (isEditing && selectedStrategy) {
                    let currentChecklist: Map<string, ChecklistItem[]>;
                    if (editingChecklists.has(selectedStrategy)) {
                      currentChecklist = editingChecklists.get(selectedStrategy)!;
                    } else {
                      const existing = checklists.get(selectedStrategy) || new Map<string, ChecklistItem[]>();
                      currentChecklist = new Map(existing.entries());
                      setEditingChecklists(new Map(editingChecklists.set(selectedStrategy, currentChecklist)));
                      if (!checklistEditHistory.has(selectedStrategy)) {
                        const orig = new Map<string, ChecklistItem[]>();
                        for (const [k, v] of existing.entries()) orig.set(k, v.map((i) => ({ ...i })));
                        setChecklistEditHistory(new Map(checklistEditHistory.set(selectedStrategy, [orig])));
                      }
                    }
                    const updated = addChecklistTypeToMap(currentChecklist, typeName, true);
                    setEditingChecklists(new Map(editingChecklists.set(selectedStrategy, updated)));
                    const history = checklistEditHistory.get(selectedStrategy) || [];
                    setChecklistEditHistory(new Map(checklistEditHistory.set(selectedStrategy, [...history, new Map(updated)].slice(-10))));
                    const customSet = new Set(customChecklistTypes.get(selectedStrategy) || []);
                    customSet.add(typeName);
                    setCustomChecklistTypes(new Map(customChecklistTypes.set(selectedStrategy, customSet)));
                  } else if (selectedStrategy) {
                    const currentChecklist = checklists.get(selectedStrategy) || new Map<string, ChecklistItem[]>();
                    const updated = addChecklistTypeToMap(currentChecklist, typeName, true);
                    setChecklists(new Map(checklists.set(selectedStrategy, updated)));
                    const customSet = new Set(customChecklistTypes.get(selectedStrategy) || []);
                    customSet.add(typeName);
                    setCustomChecklistTypes(new Map(customChecklistTypes.set(selectedStrategy, customSet)));
                  }
                  setShowAddSurveyModal(false);
                  setNewSurveyName("");
                }}
                style={{
                  padding: "8px 16px",
                  borderRadius: "6px",
                  border: "none",
                  background: newSurveyName.trim() ? "var(--accent)" : "var(--bg-tertiary)",
                  color: newSurveyName.trim() ? "white" : "var(--text-secondary)",
                  cursor: newSurveyName.trim() ? "pointer" : "not-allowed",
                  fontWeight: "500",
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
                marginBottom: "16px",
                lineHeight: "1.5",
              }}
            >
              Is this CSV file from Webull or Coinbase?
            </p>
            {dataMode !== "sandbox" && (
              <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "14px", color: "var(--text-primary)", marginBottom: "20px" }}>
                <input
                  type="checkbox"
                  checked={markImportedTradesAsPaper}
                  onChange={(e) => setMarkImportedTradesAsPaper(e.target.checked)}
                />
                <span>Mark imported trades as paper trades</span>
              </label>
            )}
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
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--border-color)",
                      background: "var(--bg-primary)",
                      color: addTradeForm.side === "BUY" ? "var(--profit)" : "var(--loss)",
                      fontSize: "14px",
                      fontWeight: "600",
                    }}
                  >
                    <option value="BUY" style={{ color: "var(--profit)" }}>BUY</option>
                    <option value="SELL" style={{ color: "var(--loss)" }}>SELL</option>
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
              <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "14px", color: "var(--text-primary)" }}>
                <input
                  type="checkbox"
                  checked={addTradeForm.isPaperTrade}
                  onChange={(e) => setAddTradeForm(f => ({ ...f, isPaperTrade: e.target.checked }))}
                />
                <span>Flag as paper trade</span>
              </label>
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
