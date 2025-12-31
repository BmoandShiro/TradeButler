import { useEffect, useState, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/tauri";
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
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Activity,
  Settings,
  TrendingUp as TrendingUpIcon,
  BarChart3,
  Clock,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  GripVertical,
  Copy,
  Trash2,
} from "lucide-react";
import { MetricsConfigPanel, useMetricsConfig } from "../components/MetricsConfig";
import { TimeframeSelector, Timeframe, getTimeframeDates } from "../components/TimeframeSelector";
import { format } from "date-fns";

interface Metrics {
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  total_profit_loss: number;
  win_rate: number;
  average_profit: number;
  average_loss: number;
  largest_win: number;
  largest_loss: number;
  total_volume: number;
  trades_by_symbol: Array<{ symbol: string; count: number; profit_loss: number }>;
  consecutive_wins: number;
  consecutive_losses: number;
  current_win_streak: number;
  current_loss_streak: number;
  strategy_win_rate: number;
  strategy_winning_trades: number;
  strategy_losing_trades: number;
  strategy_profit_loss: number;
  strategy_consecutive_wins: number;
  strategy_consecutive_losses: number;
  expectancy: number;
  profit_factor: number;
  average_trade: number;
  total_fees: number;
  net_profit: number;
  max_drawdown: number;
  sharpe_ratio: number;
  risk_reward_ratio: number;
  trades_per_day: number;
  best_day: number;
  worst_day: number;
  best_day_date?: string | null;
  worst_day_date?: string | null;
  largest_win_group_id?: number | null;
  largest_loss_group_id?: number | null;
  average_holding_time_seconds: number;
}

interface TopSymbol {
  symbol: string;
  trade_count: number;
  total_volume: number;
  estimated_pnl: number;
}

interface SymbolPnL {
  symbol: string;
  closed_positions: number;
  open_position_qty: number;
  total_gross_pnl: number;
  total_net_pnl: number;
  total_fees: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
}

interface Strategy {
  id: number;
  name: string;
  description: string | null;
  notes: string | null;
  created_at: string | null;
  color: string | null;
}

interface StrategyPerformance {
  strategy_id: number | null;
  strategy_name: string;
  trade_count: number;
  total_volume: number;
  estimated_pnl: number;
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

interface RecentTrade {
  symbol: string;
  entry_timestamp: string;
  exit_timestamp: string;
  quantity: number;
  entry_price: number;
  exit_price: number;
  net_profit_loss: number;
  strategy_name: string | null;
}

const metricIcons: Record<string, any> = {
  total_trades: Activity,
  total_volume: DollarSign,
  total_profit_loss: DollarSign,
  win_rate: TrendingUp,
  winning_trades: TrendingUp,
  losing_trades: TrendingDown,
  average_profit: TrendingUp,
  average_loss: TrendingDown,
  largest_win: TrendingUp,
  largest_loss: TrendingDown,
  consecutive_wins: TrendingUp,
  consecutive_losses: TrendingDown,
  current_win_streak: TrendingUp,
  current_loss_streak: TrendingDown,
  strategy_win_rate: TrendingUp,
  strategy_winning_trades: TrendingUp,
  strategy_losing_trades: TrendingDown,
  strategy_profit_loss: DollarSign,
  strategy_consecutive_wins: TrendingUp,
  strategy_consecutive_losses: TrendingDown,
  average_holding_time_seconds: Clock,
};

const formatMetricValue = (id: string, value: number, metrics: Metrics | null): string => {
  if (metrics === null) return "0";

  switch (id) {
    case "total_trades":
      return value.toString();
    case "total_volume":
      return `$${((value || 0) / 1000).toFixed(1)}k`;
    case "total_profit_loss":
    case "average_profit":
    case "average_loss":
    case "largest_win":
    case "largest_loss":
    case "average_trade":
    case "total_fees":
    case "net_profit":
    case "max_drawdown":
    case "best_day":
    case "worst_day":
      // largest_loss is stored as negative, so display it as-is
      return `$${(value || 0).toFixed(2)}`;
    case "win_rate":
      return `${((value || 0) * 100).toFixed(1)}%`;
    case "expectancy":
    case "profit_factor":
    case "sharpe_ratio":
    case "risk_reward_ratio":
    case "trades_per_day":
      return (value || 0).toFixed(2);
    case "winning_trades":
    case "losing_trades":
    case "consecutive_wins":
    case "consecutive_losses":
    case "current_win_streak":
    case "current_loss_streak":
    case "strategy_winning_trades":
    case "strategy_losing_trades":
    case "strategy_consecutive_wins":
    case "strategy_consecutive_losses":
      return value.toString();
    case "strategy_win_rate":
      return `${((value || 0) * 100).toFixed(1)}%`;
    case "strategy_profit_loss":
      return `$${(value || 0).toFixed(2)}`;
    case "average_holding_time_seconds":
      return formatHoldingTime(value || 0);
    default:
      return value.toFixed(2);
  }
};

const formatHoldingTime = (seconds: number): string => {
  if (seconds === 0) return "0s";
  
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 && days === 0 && hours === 0) parts.push(`${secs}s`);
  
  return parts.join(" ") || "0s";
};

const getMetricColor = (id: string, value: number, colorRange?: { min: number; max: number }): string => {
  // Get color range from localStorage if not provided
  if (!colorRange) {
    const saved = localStorage.getItem("tradebutler_color_range");
    if (saved) {
      try {
        colorRange = JSON.parse(saved);
      } catch {
        colorRange = undefined;
      }
    }
  }
  
  // Max drawdown should always be red (it represents a loss)
  if (id === "max_drawdown") {
    return "var(--loss)";
  }
  
  // Dollar-based metrics that should use color range
  const dollarMetrics = [
    "total_profit_loss", "strategy_profit_loss", "average_profit", "average_loss",
    "largest_win", "largest_loss", "average_trade", "total_fees", "net_profit",
    "best_day", "worst_day", "expectancy"
  ];
  
  // Apply color range for dollar metrics
  if (dollarMetrics.includes(id) && colorRange) {
    if (value < colorRange.min) {
      return "var(--loss)"; // Below range = red
    } else if (value > colorRange.max) {
      return "var(--profit)"; // Above range = green
    } else {
      return "var(--accent)"; // Within range = blue
    }
  }
  
  // Default behavior: positive = green, negative = red, zero = blue
  if (value > 0) {
    // Positive values
    if (id.includes("loss") || id.includes("losing")) {
      // Loss-related metrics should be red even if positive
      return "var(--loss)";
    }
    return "var(--profit)";
  } else if (value < 0) {
    // Negative values
    return "var(--loss)";
  } else {
    // Zero values
    return "var(--accent)";
  }
};

const DASHBOARD_SECTIONS_KEY = "tradebutler_dashboard_sections";
const DASHBOARD_SECTION_ORDER_KEY = "tradebutler_dashboard_section_order";
const METRIC_CARDS_ORDER_KEY = "tradebutler_metric_cards_order";
const METRIC_INSTANCES_KEY = "tradebutler_metric_instances";

interface MetricInstance {
  instanceId: string; // e.g., "strategy_win_rate_1", "strategy_win_rate_2"
  baseMetricId: string; // e.g., "strategy_win_rate"
  strategyFilterId: number | null; // Strategy filter for this instance
}

interface DashboardSections {
  showTopSymbols: boolean;
  showStrategyPerformance: boolean;
  showRecentTrades: boolean;
  showTrades: boolean;
}

const defaultDashboardSections: DashboardSections = {
  showTopSymbols: true,
  showStrategyPerformance: true,
  showRecentTrades: true,
  showTrades: true,
};

type SectionId = "topSymbols" | "strategyPerformance" | "recentTrades" | "trades";

const defaultSectionOrder: SectionId[] = ["topSymbols", "strategyPerformance", "recentTrades", "trades"];

// Sortable Metric Card Component
// SortableSection component for dashboard sections
function SortableSection({
  id,
  children,
}: {
  id: SectionId;
  children: (props: { dragHandleProps: any; isDragging: boolean }) => React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      {children({ dragHandleProps: { ...attributes, ...listeners }, isDragging })}
    </div>
  );
}

// Metric descriptions mapping
const metricDescriptions: Record<string, { description: string; calculation: string }> = {
  total_trades: {
    description: "The total number of closed trade pairs (positions) during the selected timeframe.",
    calculation: "Count of all paired trades (entry + exit) that have been closed."
  },
  total_volume: {
    description: "The total dollar volume of all trades executed during the selected timeframe.",
    calculation: "Sum of (quantity × price) for all trades."
  },
  total_profit_loss: {
    description: "The total net profit or loss from all closed positions, including fees.",
    calculation: "Sum of net_profit_loss for all paired trades (gross P&L minus entry and exit fees)."
  },
  win_rate: {
    description: "The percentage of closed trades that resulted in a profit.",
    calculation: "Winning trades ÷ Total trades × 100%"
  },
  winning_trades: {
    description: "The number of closed trades that resulted in a profit.",
    calculation: "Count of paired trades where net_profit_loss > 0"
  },
  losing_trades: {
    description: "The number of closed trades that resulted in a loss.",
    calculation: "Count of paired trades where net_profit_loss < 0"
  },
  average_profit: {
    description: "The average profit per winning trade.",
    calculation: "Total profit from winning trades ÷ Number of winning trades"
  },
  average_loss: {
    description: "The average loss per losing trade.",
    calculation: "Total loss from losing trades ÷ Number of losing trades"
  },
  largest_win: {
    description: "The single largest profit from a closed position (complete position, including all adds and closes).",
    calculation: "Maximum total_pnl from all position groups"
  },
  largest_loss: {
    description: "The single largest loss from a closed position (complete position, including all adds and closes).",
    calculation: "Minimum (most negative) total_pnl from all position groups"
  },
  average_trade: {
    description: "The average profit or loss per trade across all closed positions.",
    calculation: "Total P&L ÷ Total number of trades"
  },
  profit_factor: {
    description: "A ratio comparing total gross profit to total gross loss. Values above 1.0 indicate profitability.",
    calculation: "Total gross profit ÷ Total gross loss"
  },
  expectancy: {
    description: "The expected value per trade, indicating average profit per trade over time.",
    calculation: "(Win Rate × Average Win) - (Loss Rate × Average Loss)"
  },
  max_drawdown: {
    description: "The largest peak-to-trough decline in equity during the selected timeframe.",
    calculation: "Maximum difference between peak equity and subsequent equity low"
  },
  sharpe_ratio: {
    description: "A measure of risk-adjusted return (currently not implemented).",
    calculation: "Not yet implemented"
  },
  risk_reward_ratio: {
    description: "The ratio of average win to average loss, indicating the risk/reward profile.",
    calculation: "Average Win ÷ Average Loss"
  },
  consecutive_wins: {
    description: "The longest streak of consecutive winning trades in your history.",
    calculation: "Maximum consecutive count of trades with net_profit_loss > 0"
  },
  consecutive_losses: {
    description: "The longest streak of consecutive losing trades in your history.",
    calculation: "Maximum consecutive count of trades with net_profit_loss < 0"
  },
  current_win_streak: {
    description: "The current number of consecutive winning trades (from most recent trades).",
    calculation: "Count of consecutive winning trades starting from the most recent trade"
  },
  current_loss_streak: {
    description: "The current number of consecutive losing trades (from most recent trades).",
    calculation: "Count of consecutive losing trades starting from the most recent trade"
  },
  total_fees: {
    description: "The total amount paid in trading fees (entry fees + exit fees) for all closed positions.",
    calculation: "Sum of (entry_fees + exit_fees) for all paired trades"
  },
  net_profit: {
    description: "Total profit or loss after accounting for all fees (same as Total P&L).",
    calculation: "Total P&L (already includes fees in net_profit_loss calculation)"
  },
  trades_per_day: {
    description: "The average number of trades executed per trading day during the selected timeframe.",
    calculation: "Total trades ÷ Number of trading days with trades"
  },
  best_day: {
    description: "The single best trading day by net profit during the selected timeframe.",
    calculation: "Maximum daily P&L from all trading days"
  },
  worst_day: {
    description: "The single worst trading day by net loss during the selected timeframe.",
    calculation: "Minimum (most negative) daily P&L from all trading days"
  },
  average_holding_time_seconds: {
    description: "The average amount of time positions are held open before being closed.",
    calculation: "Sum of (exit_timestamp - entry_timestamp) for all paired trades ÷ Number of trades"
  },
  strategy_win_rate: {
    description: "The win rate for trades assigned to strategies (excluding unassigned trades).",
    calculation: "Strategy winning trades ÷ (Strategy winning trades + Strategy losing trades) × 100%"
  },
  strategy_winning_trades: {
    description: "The number of winning trades that are assigned to strategies.",
    calculation: "Count of strategy-assigned trades where net_profit_loss > 0"
  },
  strategy_losing_trades: {
    description: "The number of losing trades that are assigned to strategies.",
    calculation: "Count of strategy-assigned trades where net_profit_loss < 0"
  },
  strategy_profit_loss: {
    description: "The total profit or loss from all trades assigned to strategies.",
    calculation: "Sum of net_profit_loss for all strategy-assigned trades"
  },
  strategy_consecutive_wins: {
    description: "The longest streak of consecutive winning trades for strategy-assigned trades.",
    calculation: "Maximum consecutive count of strategy trades with net_profit_loss > 0"
  },
  strategy_consecutive_losses: {
    description: "The longest streak of consecutive losing trades for strategy-assigned trades.",
    calculation: "Maximum consecutive count of strategy trades with net_profit_loss < 0"
  },
};

function SortableMetricCard({
  id,
  metric,
  value,
  Icon,
  color,
  metrics,
  formatMetricValue,
  setTimeframe,
  setCustomStartDate,
  setCustomEndDate,
  setSelectedPositionGroupId,
  setShowPositionGroupModal,
  setSelectedPositionGroup,
  openMetricSettings,
  setOpenMetricSettings,
  metricMenuPosition,
  setMetricMenuPosition,
  sortedMetrics,
  enabledMetrics,
  setMetricCardOrder,
  strategies,
  strategyFilterForMetrics,
  setStrategyFilterForMetrics,
  duplicateMetricInstance,
  removeMetricInstance,
  setMetricInstances,
}: {
  id: string;
  metric: any;
  value: number;
  Icon: any;
  color: string;
  metrics: Metrics | null;
  formatMetricValue: (id: string, value: number, metrics: Metrics | null) => string;
  setTimeframe: (timeframe: Timeframe) => void;
  setCustomStartDate: (date: string) => void;
  setCustomEndDate: (date: string) => void;
  setSelectedPositionGroupId: (id: number | null) => void;
  setShowPositionGroupModal: (show: boolean) => void;
  setSelectedPositionGroup: (group: any) => void;
  openMetricSettings: string | null;
  setOpenMetricSettings: (id: string | null) => void;
  metricMenuPosition: { top: number; right: number };
  setMetricMenuPosition: (pos: { top: number; right: number }) => void;
  sortedMetrics: any[];
  enabledMetrics: any[];
  setMetricCardOrder: React.Dispatch<React.SetStateAction<string[]>>;
  strategies: Strategy[];
  strategyFilterForMetrics: Record<string, number | null>;
  setStrategyFilterForMetrics: React.Dispatch<React.SetStateAction<Record<string, number | null>>>;
  duplicateMetricInstance: (instanceId: string) => void;
  removeMetricInstance: (instanceId: string) => void;
  setMetricInstances: React.Dispatch<React.SetStateAction<MetricInstance[]>>;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={{
        backgroundColor: "var(--bg-secondary)",
        border: "1px solid var(--border-color)",
        borderRadius: "8px",
        padding: "20px",
        display: "flex",
        alignItems: "center",
        gap: "16px",
        cursor: isDragging ? "grabbing" : "grab",
        userSelect: "none",
        WebkitUserSelect: "none",
        width: "100%",
        height: "100px",
        ...style,
      }}
    >
      <div {...attributes} {...listeners} style={{ cursor: "grab", flexShrink: 0 }}>
        <GripVertical size={16} color="var(--text-secondary)" />
      </div>
      <div
        style={{
          width: "48px",
          height: "48px",
          borderRadius: "8px",
          backgroundColor: `${color}20`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: color,
          flexShrink: 0,
          pointerEvents: "none",
        }}
      >
        <Icon size={24} />
      </div>
      <div 
        style={{ 
          flex: 1, 
          pointerEvents: ((metric as any).baseMetricId === "best_day" || (metric as any).baseMetricId === "worst_day" || (metric as any).baseMetricId === "largest_win" || (metric as any).baseMetricId === "largest_loss") ? "auto" : "none",
          cursor: ((metric as any).baseMetricId === "best_day" || (metric as any).baseMetricId === "worst_day" || (metric as any).baseMetricId === "largest_win" || (metric as any).baseMetricId === "largest_loss") ? "pointer" : "default",
        }}
        onClick={async (e) => {
          const baseMetricId = (metric as any).baseMetricId || metric.id;
          if (baseMetricId === "best_day" && metrics?.best_day_date) {
            e.stopPropagation();
            setTimeframe("custom");
            setCustomStartDate(metrics.best_day_date);
            setCustomEndDate(metrics.best_day_date);
            localStorage.setItem("tradebutler_dashboard_timeframe", "custom");
            localStorage.setItem("tradebutler_dashboard_custom_start", metrics.best_day_date);
            localStorage.setItem("tradebutler_dashboard_custom_end", metrics.best_day_date);
          } else if (baseMetricId === "worst_day" && metrics?.worst_day_date) {
            e.stopPropagation();
            setTimeframe("custom");
            setCustomStartDate(metrics.worst_day_date);
            setCustomEndDate(metrics.worst_day_date);
            localStorage.setItem("tradebutler_dashboard_timeframe", "custom");
            localStorage.setItem("tradebutler_dashboard_custom_start", metrics.worst_day_date);
            localStorage.setItem("tradebutler_dashboard_custom_end", metrics.worst_day_date);
          } else if (baseMetricId === "largest_win" && metrics?.largest_win_group_id) {
            e.stopPropagation();
            setSelectedPositionGroupId(metrics.largest_win_group_id);
            setShowPositionGroupModal(true);
            try {
              const pairingMethod = localStorage.getItem("tradebutler_pairing_method") || "FIFO";
              const groups = await invoke<any[]>("get_position_groups", { pairingMethod, startDate: null, endDate: null });
              const group = groups.find(g => g.entry_trade.id === metrics.largest_win_group_id);
              if (group) {
                setSelectedPositionGroup(group);
              }
            } catch (error) {
              console.error("Error loading position group:", error);
            }
          } else if (baseMetricId === "largest_loss" && metrics?.largest_loss_group_id) {
            e.stopPropagation();
            setSelectedPositionGroupId(metrics.largest_loss_group_id);
            setShowPositionGroupModal(true);
            try {
              const pairingMethod = localStorage.getItem("tradebutler_pairing_method") || "FIFO";
              const groups = await invoke<any[]>("get_position_groups", { pairingMethod, startDate: null, endDate: null });
              const group = groups.find(g => g.entry_trade.id === metrics.largest_loss_group_id);
              if (group) {
                setSelectedPositionGroup(group);
              }
            } catch (error) {
              console.error("Error loading position group:", error);
            }
          }
        }}
      >
        <p
          style={{
            fontSize: "14px",
            color: "var(--text-secondary)",
            marginBottom: "4px",
          }}
        >
          {(() => {
            // Only use instanceId for the filter - never fall back to baseMetricId
            const selectedStrategyId = strategyFilterForMetrics[metric.id];
            if (selectedStrategyId !== null && selectedStrategyId !== undefined) {
              const strategy = strategies.find(s => s.id === selectedStrategyId);
              if (strategy) {
                return `${metric.label} (${strategy.name})`;
              }
            }
            return metric.label;
          })()}
        </p>
        <p
          style={{
            fontSize: "24px",
            fontWeight: "bold",
            color: color,
          }}
        >
          {formatMetricValue((metric as any).baseMetricId || metric.id, value, metrics)}
        </p>
      </div>
      <div style={{ position: "relative", flexShrink: 0 }}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setMetricMenuPosition({
              top: rect.bottom + 4,
              right: window.innerWidth - rect.right,
            });
            setOpenMetricSettings(openMetricSettings === metric.id ? null : metric.id);
          }}
          onMouseDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
          style={{
            background: "transparent",
            border: "none",
            padding: "4px",
            cursor: "pointer",
            color: "var(--text-secondary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "4px",
            pointerEvents: "auto",
          }}
          title="Settings"
        >
          <Settings size={16} />
        </button>
        {openMetricSettings === metric.id && createPortal(
          <div
            data-settings-menu
            style={{
              position: "fixed",
              top: `${metricMenuPosition.top}px`,
              right: `${metricMenuPosition.right}px`,
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "8px",
              padding: "0",
              boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
              zIndex: 99999,
              minWidth: "280px",
              maxWidth: "400px",
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {/* Metric Description */}
              {metricDescriptions[(metric as any).baseMetricId || metric.id] && (
                <div
                  style={{
                    padding: "12px",
                    borderBottom: "1px solid var(--border-color)",
                    marginBottom: "4px",
                  }}
                >
                  <div
                    style={{
                      fontSize: "12px",
                      fontWeight: "600",
                      color: "var(--text-primary)",
                      marginBottom: "8px",
                    }}
                  >
                    {metric.label}
                  </div>
                  <div
                    style={{
                      fontSize: "11px",
                      color: "var(--text-secondary)",
                      lineHeight: "1.5",
                      marginBottom: "8px",
                    }}
                  >
                    {metricDescriptions[(metric as any).baseMetricId || metric.id].description}
                  </div>
                  <div
                    style={{
                      fontSize: "10px",
                      color: "var(--text-secondary)",
                      fontStyle: "italic",
                      paddingTop: "8px",
                      borderTop: "1px solid var(--border-color)",
                    }}
                  >
                    <strong>Calculation:</strong> {metricDescriptions[(metric as any).baseMetricId || metric.id].calculation}
                  </div>
                </div>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  const currentIndex = sortedMetrics.findIndex(m => m.id === metric.id);
                  if (currentIndex > 0) {
                    setMetricCardOrder(prevOrder => {
                      const currentIds = enabledMetrics.map(m => m.id);
                      let newOrder = [...prevOrder];
                      
                      currentIds.forEach(id => {
                        if (!newOrder.includes(id)) {
                          newOrder.push(id);
                        }
                      });
                      
                      newOrder = newOrder.filter(id => currentIds.includes(id));
                      
                      const metricIndex = newOrder.indexOf(metric.id);
                      if (metricIndex > 0) {
                        [newOrder[metricIndex - 1], newOrder[metricIndex]] = [newOrder[metricIndex], newOrder[metricIndex - 1]];
                        localStorage.setItem(METRIC_CARDS_ORDER_KEY, JSON.stringify(newOrder));
                        return newOrder;
                      }
                      return prevOrder;
                    });
                  }
                }}
                disabled={sortedMetrics.findIndex(m => m.id === metric.id) === 0}
                style={{
                  background: "transparent",
                  border: "1px solid var(--border-color)",
                  borderRadius: "4px",
                  padding: "6px 8px",
                  cursor: sortedMetrics.findIndex(m => m.id === metric.id) === 0 ? "not-allowed" : "pointer",
                  color: "var(--text-primary)",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "13px",
                  opacity: sortedMetrics.findIndex(m => m.id === metric.id) === 0 ? 0.3 : 1,
                }}
              >
                <ChevronUp size={14} />
                <span>Move Up</span>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  const currentIndex = sortedMetrics.findIndex(m => m.id === metric.id);
                  if (currentIndex < sortedMetrics.length - 1) {
                    setMetricCardOrder(prevOrder => {
                      const currentIds = enabledMetrics.map(m => m.id);
                      let newOrder = [...prevOrder];
                      
                      currentIds.forEach(id => {
                        if (!newOrder.includes(id)) {
                          newOrder.push(id);
                        }
                      });
                      
                      newOrder = newOrder.filter(id => currentIds.includes(id));
                      
                      const metricIndex = newOrder.indexOf(metric.id);
                      if (metricIndex < newOrder.length - 1) {
                        [newOrder[metricIndex], newOrder[metricIndex + 1]] = [newOrder[metricIndex + 1], newOrder[metricIndex]];
                        localStorage.setItem(METRIC_CARDS_ORDER_KEY, JSON.stringify(newOrder));
                        return newOrder;
                      }
                      return prevOrder;
                    });
                  }
                }}
                disabled={sortedMetrics.findIndex(m => m.id === metric.id) === sortedMetrics.length - 1}
                style={{
                  background: "transparent",
                  border: "1px solid var(--border-color)",
                  borderRadius: "4px",
                  padding: "6px 8px",
                  cursor: sortedMetrics.findIndex(m => m.id === metric.id) === sortedMetrics.length - 1 ? "not-allowed" : "pointer",
                  color: "var(--text-primary)",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "13px",
                  opacity: sortedMetrics.findIndex(m => m.id === metric.id) === sortedMetrics.length - 1 ? 0.3 : 1,
                }}
              >
                <ChevronDown size={14} />
                <span>Move Down</span>
              </button>
              <div style={{ borderTop: "1px solid var(--border-color)", margin: "4px 0" }} />
              <div style={{ borderTop: "1px solid var(--border-color)", margin: "4px 0" }} />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  duplicateMetricInstance(metric.id);
                  setOpenMetricSettings(null);
                }}
                style={{
                  background: "transparent",
                  border: "1px solid var(--border-color)",
                  borderRadius: "4px",
                  padding: "6px 8px",
                  cursor: "pointer",
                  color: "var(--text-primary)",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "13px",
                }}
              >
                <Copy size={14} />
                <span>Duplicate</span>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  removeMetricInstance(metric.id);
                  setOpenMetricSettings(null);
                }}
                style={{
                  background: "transparent",
                  border: "1px solid var(--border-color)",
                  borderRadius: "4px",
                  padding: "6px 8px",
                  cursor: "pointer",
                  color: "var(--loss)",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "13px",
                }}
              >
                <Trash2 size={14} />
                <span>Remove</span>
              </button>
              {/* Strategy Selector for Strategy Metrics */}
              {[
                "strategy_win_rate",
                "strategy_winning_trades",
                "strategy_losing_trades",
                "strategy_profit_loss",
                "strategy_consecutive_wins",
                "strategy_consecutive_losses",
              ].includes((metric as any).baseMetricId || metric.id) && (
                <>
                  <div style={{ borderTop: "1px solid var(--border-color)", margin: "4px 0" }} />
                  <div style={{ padding: "8px", display: "flex", flexDirection: "column", gap: "8px" }}>
                    <label style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>
                      Filter by Strategy:
                    </label>
                    <select
                      value={strategyFilterForMetrics[metric.id] ?? ""}
                      onChange={(e) => {
                        const value = e.target.value === "" ? null : parseInt(e.target.value, 10);
                        // Only update the specific instance, never the baseMetricId
                        setStrategyFilterForMetrics((prev: Record<string, number | null>) => {
                          const updated: Record<string, number | null> = { ...prev, [metric.id]: value };
                          localStorage.setItem("tradebutler_strategy_filter_for_metrics", JSON.stringify(updated));
                          return updated;
                        });
                        
                        // Update instance strategy filter
                        setMetricInstances((prev: MetricInstance[]) => {
                          const updated = prev.map((inst: MetricInstance) => 
                            inst.instanceId === metric.id 
                              ? { ...inst, strategyFilterId: value }
                              : inst
                          );
                          localStorage.setItem(METRIC_INSTANCES_KEY, JSON.stringify(updated));
                          return updated;
                        });
                      }}
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      style={{
                        padding: "6px 8px",
                        backgroundColor: "var(--bg-tertiary)",
                        border: "1px solid var(--border-color)",
                        borderRadius: "4px",
                        color: "var(--text-primary)",
                        fontSize: "13px",
                        width: "100%",
                        cursor: "pointer",
                      }}
                    >
                      <option value="">All Strategies</option>
                      {strategies.map((strategy: Strategy) => (
                        <option key={strategy.id} value={strategy.id}>
                          {strategy.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}
            </div>
          </div>,
          document.body
        )}
      </div>
    </div>
  );
}

// Global function to reset metric instances (can be called from browser console)
if (typeof window !== 'undefined') {
  (window as any).resetMetricInstances = () => {
    localStorage.removeItem(METRIC_INSTANCES_KEY);
    localStorage.removeItem(METRIC_CARDS_ORDER_KEY);
    localStorage.removeItem("tradebutler_strategy_filter_for_metrics");
    console.log("Metric instances reset. Please refresh the page.");
    return true;
  };
}

export default function Dashboard() {
  const metricsConfigHook = useMetricsConfig();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [topSymbols, setTopSymbols] = useState<TopSymbol[]>([]);
  const [strategyPerformance, setStrategyPerformance] = useState<StrategyPerformance[]>([]);
  const [recentTrades, setRecentTrades] = useState<RecentTrade[]>([]);
  const [trades, setTrades] = useState<RecentTrade[]>([]);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [strategyFilterForMetrics, setStrategyFilterForMetrics] = useState<Record<string, number | null>>(() => {
    const saved = localStorage.getItem("tradebutler_strategy_filter_for_metrics");
    return saved ? JSON.parse(saved) : {};
  });
  
  // Metric instances system - track multiple instances of the same metric type
  const [metricInstances, setMetricInstances] = useState<MetricInstance[]>(() => {
    const saved = localStorage.getItem(METRIC_INSTANCES_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Safety check: limit instances per metric to prevent performance issues
        const MAX_INSTANCES_PER_METRIC = 10;
        const instanceCounts: Record<string, number> = {};
        const cleaned: MetricInstance[] = [];
        
        for (const inst of parsed) {
          if (!inst || !inst.baseMetricId || !inst.instanceId) continue; // Skip invalid entries
          const count = (instanceCounts[inst.baseMetricId] || 0) + 1;
          if (count <= MAX_INSTANCES_PER_METRIC) {
            instanceCounts[inst.baseMetricId] = count;
            cleaned.push(inst);
          }
        }
        
        // If we had to clean up, save the cleaned version
        if (cleaned.length !== parsed.length) {
          console.warn(`Cleaned up metric instances: ${parsed.length} -> ${cleaned.length}`);
          localStorage.setItem(METRIC_INSTANCES_KEY, JSON.stringify(cleaned));
        }
        
        return cleaned;
      } catch {
        // If corrupted, clear it
        localStorage.removeItem(METRIC_INSTANCES_KEY);
        return [];
      }
    }
    // Initialize: create one instance for each enabled metric
    const enabled = metricsConfigHook.getEnabledMetrics();
    return enabled.map(m => ({
      instanceId: m.id,
      baseMetricId: m.id,
      strategyFilterId: null,
    }));
  });
  
  // Helper to get next instance ID for a base metric
  const getNextInstanceId = (baseMetricId: string): string => {
    const existingInstances = metricInstances.filter(m => m.baseMetricId === baseMetricId);
    if (existingInstances.length === 0) {
      return baseMetricId; // First instance uses base ID
    }
    // Find the highest number suffix
    let maxNum = 0;
    existingInstances.forEach(inst => {
      if (inst.instanceId === baseMetricId) {
        maxNum = Math.max(maxNum, 1);
      } else {
        const match = inst.instanceId.match(new RegExp(`^${baseMetricId}_(\\d+)$`));
        if (match) {
          maxNum = Math.max(maxNum, parseInt(match[1], 10));
        }
      }
    });
    return `${baseMetricId}_${maxNum + 1}`;
  };
  
  // Helper to duplicate a metric instance
  const duplicateMetricInstance = (instanceId: string) => {
    const instance = metricInstances.find(m => m.instanceId === instanceId);
    if (!instance) return;
    
    // Limit instances per metric to prevent performance issues
    const MAX_INSTANCES_PER_METRIC = 10;
    const instancesOfBase = metricInstances.filter(m => m.baseMetricId === instance.baseMetricId);
    if (instancesOfBase.length >= MAX_INSTANCES_PER_METRIC) {
      alert(`Maximum of ${MAX_INSTANCES_PER_METRIC} instances per metric allowed. Please remove some instances first.`);
      return;
    }
    
    const newInstanceId = getNextInstanceId(instance.baseMetricId);
    const newInstance: MetricInstance = {
      instanceId: newInstanceId,
      baseMetricId: instance.baseMetricId,
      strategyFilterId: instance.strategyFilterId,
    };
    
    const updatedInstances = [...metricInstances, newInstance];
    setMetricInstances(updatedInstances);
    localStorage.setItem(METRIC_INSTANCES_KEY, JSON.stringify(updatedInstances));
    
    // Add to metric card order
    setMetricCardOrder(prev => {
      const newOrder = [...prev, newInstanceId];
      localStorage.setItem(METRIC_CARDS_ORDER_KEY, JSON.stringify(newOrder));
      return newOrder;
    });
    
    // Copy strategy filter if exists
    if (instance.strategyFilterId !== null) {
      setStrategyFilterForMetrics(prev => {
        const updated = { ...prev, [newInstanceId]: instance.strategyFilterId };
        localStorage.setItem("tradebutler_strategy_filter_for_metrics", JSON.stringify(updated));
        return updated;
      });
    }
    
    setConfigKey(prev => prev + 1);
  };
  
  // Helper to remove a metric instance
  const removeMetricInstance = (instanceId: string) => {
    const instance = metricInstances.find(m => m.instanceId === instanceId);
    if (!instance) return;
    
    // Don't allow removing the last instance of a base metric
    const instancesOfBase = metricInstances.filter(m => m.baseMetricId === instance.baseMetricId);
    if (instancesOfBase.length <= 1) {
      // If it's the last instance, disable the base metric instead
      metricsConfigHook.toggleMetric(instance.baseMetricId);
      setConfigKey(prev => prev + 1);
      return;
    }
    
    const updatedInstances = metricInstances.filter(m => m.instanceId !== instanceId);
    setMetricInstances(updatedInstances);
    localStorage.setItem(METRIC_INSTANCES_KEY, JSON.stringify(updatedInstances));
    
    // Remove from metric card order
    setMetricCardOrder(prev => {
      const newOrder = prev.filter(id => id !== instanceId);
      localStorage.setItem(METRIC_CARDS_ORDER_KEY, JSON.stringify(newOrder));
      return newOrder;
    });
    
    // Remove strategy filter if exists
    setStrategyFilterForMetrics(prev => {
      const updated = { ...prev };
      delete updated[instanceId];
      localStorage.setItem("tradebutler_strategy_filter_for_metrics", JSON.stringify(updated));
      return updated;
    });
    
    setConfigKey(prev => prev + 1);
  };
  
  // Helper to add a new instance of a base metric
  const addMetricInstance = (baseMetricId: string) => {
    // Ensure base metric is enabled first
    const allMetrics = metricsConfigHook.metrics;
    const baseMetric = allMetrics.find(m => m.id === baseMetricId);
    if (!baseMetric) return;
    
    // Limit instances per metric to prevent performance issues
    const MAX_INSTANCES_PER_METRIC = 10;
    const instancesOfBase = metricInstances.filter(m => m.baseMetricId === baseMetricId);
    if (instancesOfBase.length >= MAX_INSTANCES_PER_METRIC) {
      alert(`Maximum of ${MAX_INSTANCES_PER_METRIC} instances per metric allowed. Please remove some instances first.`);
      return;
    }
    
    if (!baseMetric.enabled) {
      metricsConfigHook.toggleMetric(baseMetricId);
    }
    
    const newInstanceId = getNextInstanceId(baseMetricId);
    const newInstance: MetricInstance = {
      instanceId: newInstanceId,
      baseMetricId: baseMetricId,
      strategyFilterId: null,
    };
    
    const updatedInstances = [...metricInstances, newInstance];
    setMetricInstances(updatedInstances);
    localStorage.setItem(METRIC_INSTANCES_KEY, JSON.stringify(updatedInstances));
    
    // Add to metric card order
    setMetricCardOrder(prev => {
      const newOrder = [...prev, newInstanceId];
      localStorage.setItem(METRIC_CARDS_ORDER_KEY, JSON.stringify(newOrder));
      return newOrder;
    });
    
    setConfigKey(prev => prev + 1);
  };
  const [expandedTrades, setExpandedTrades] = useState<Set<number>>(new Set());
  const [tradesPerPage, setTradesPerPage] = useState<number>(() => {
    const saved = localStorage.getItem("tradebutler_trades_per_page");
    return saved ? parseInt(saved, 10) : 20;
  });
  const [currentTradesPage, setCurrentTradesPage] = useState<number>(1);
  const [loading, setLoading] = useState(true);
  const [showMetricsConfig, setShowMetricsConfig] = useState(false);
  const [configKey, setConfigKey] = useState(0); // Force re-render when config changes
  const [expandedRecentTrades, setExpandedRecentTrades] = useState<Set<number>>(new Set());
  const [expandedStrategies, setExpandedStrategies] = useState<Set<number | string>>(new Set());
  const [strategyPairs, setStrategyPairs] = useState<Map<number | string, PairedTrade[]>>(new Map());
  const [loadingStrategyPairs, setLoadingStrategyPairs] = useState<Set<number | string>>(new Set());
  const [strategyPairsPerPage, setStrategyPairsPerPage] = useState<number>(() => {
    const saved = localStorage.getItem("tradebutler_strategy_pairs_per_page");
    return saved ? parseInt(saved, 10) : 20;
  });
  const [strategyCurrentPages, setStrategyCurrentPages] = useState<Map<number | string, number>>(new Map());
  const [dashboardSections, setDashboardSections] = useState<DashboardSections>(() => {
    const saved = localStorage.getItem(DASHBOARD_SECTIONS_KEY);
    if (saved) {
      try {
        return { ...defaultDashboardSections, ...JSON.parse(saved) };
      } catch {
        return defaultDashboardSections;
      }
    }
    return defaultDashboardSections;
  });
  const [sectionOrder, setSectionOrder] = useState<SectionId[]>(() => {
    const saved = localStorage.getItem(DASHBOARD_SECTION_ORDER_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Validate that all sections are present - include all possible sections
        const allSections: SectionId[] = ["topSymbols", "strategyPerformance", "recentTrades", "trades"];
        const validOrder = allSections.filter(id => parsed.includes(id));
        const missing = allSections.filter(id => !parsed.includes(id));
        return [...validOrder, ...missing];
      } catch {
        return defaultSectionOrder;
      }
    }
    return defaultSectionOrder;
  });
  const [metricCardOrder, setMetricCardOrder] = useState<string[]>(() => {
    const saved = localStorage.getItem(METRIC_CARDS_ORDER_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return [];
      }
    }
    return [];
  });
  // @dnd-kit sensors
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
  
  // Handle drag end for metrics
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (over && active.id !== over.id) {
      setMetricCardOrder((items) => {
        const currentInstanceIds = metricInstances.map(inst => inst.instanceId);
        let newOrder = [...items];
        
        // Ensure all instance IDs are in the order
        currentInstanceIds.forEach(id => {
          if (!newOrder.includes(id)) {
            newOrder.push(id);
          }
        });
        
        // Remove any IDs that are no longer valid instances
        newOrder = newOrder.filter(id => currentInstanceIds.includes(id));
        
        const oldIndex = newOrder.indexOf(active.id as string);
        const newIndex = newOrder.indexOf(over.id as string);
        
        if (oldIndex !== -1 && newIndex !== -1) {
          const finalOrder = arrayMove(newOrder, oldIndex, newIndex);
          localStorage.setItem(METRIC_CARDS_ORDER_KEY, JSON.stringify(finalOrder));
          return finalOrder;
        }
        
        return newOrder;
      });
    }
  };

  // Handle drag end for sections
  const handleSectionDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (over && active.id !== over.id) {
      setSectionOrder((items) => {
        const oldIndex = items.indexOf(active.id as SectionId);
        const newIndex = items.indexOf(over.id as SectionId);
        
        if (oldIndex !== -1 && newIndex !== -1) {
          const finalOrder = arrayMove(items, oldIndex, newIndex);
          localStorage.setItem(DASHBOARD_SECTION_ORDER_KEY, JSON.stringify(finalOrder));
          return finalOrder;
        }
        
        return items;
      });
    }
  };
  const [openMetricSettings, setOpenMetricSettings] = useState<string | null>(null);
  const [openSectionSettings, setOpenSectionSettings] = useState<SectionId | null>(null);
  const [metricMenuPosition, setMetricMenuPosition] = useState({ top: 0, right: 0 });
  const [sectionMenuPosition, setSectionMenuPosition] = useState<Record<SectionId, { top: number; right: number }>>({
    topSymbols: { top: 0, right: 0 },
    strategyPerformance: { top: 0, right: 0 },
    recentTrades: { top: 0, right: 0 },
    trades: { top: 0, right: 0 },
  });
  const [timeframe, setTimeframe] = useState<Timeframe>(() => {
    const saved = localStorage.getItem("tradebutler_dashboard_timeframe");
    return (saved as Timeframe) || "all";
  });
  const [customStartDate, setCustomStartDate] = useState<string>(() => {
    return localStorage.getItem("tradebutler_dashboard_custom_start") || "";
  });
  const [customEndDate, setCustomEndDate] = useState<string>(() => {
    return localStorage.getItem("tradebutler_dashboard_custom_end") || "";
  });
  const [showPositionGroupModal, setShowPositionGroupModal] = useState(false);
  const [selectedPositionGroupId, setSelectedPositionGroupId] = useState<number | null>(null);
  const [selectedPositionGroup, setSelectedPositionGroup] = useState<any>(null);
  
  // Close settings menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Don't close if clicking on a settings button or inside a settings menu
      if (target.closest('[data-settings-menu]') || target.closest('button[title="Settings"]')) {
        return;
      }
      if (openMetricSettings || openSectionSettings) {
        setOpenMetricSettings(null);
        setOpenSectionSettings(null);
      }
    };
    
    if (openMetricSettings || openSectionSettings) {
      // Use a small delay to allow the click event on the button to complete first
      setTimeout(() => {
        document.addEventListener("mousedown", handleClickOutside);
      }, 0);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [openMetricSettings, openSectionSettings]);
  
  // Re-read enabled metrics from localStorage when config changes
  const [enabledMetrics, setEnabledMetrics] = useState(() => metricsConfigHook.getEnabledMetrics());
  
  // Sync metric instances with enabled metrics
  useEffect(() => {
    const allMetrics = metricsConfigHook.metrics;
    const enabled = allMetrics.filter(m => m.enabled);
    
    setMetricInstances(prevInstances => {
      const updated: MetricInstance[] = [];
      
      // For each enabled base metric, ensure at least one instance exists
      enabled.forEach(baseMetric => {
        const instances = prevInstances.filter(m => m.baseMetricId === baseMetric.id);
        if (instances.length === 0) {
          // Create first instance
          updated.push({
            instanceId: baseMetric.id,
            baseMetricId: baseMetric.id,
            strategyFilterId: null,
          });
        } else {
          // Keep existing instances
          updated.push(...instances);
        }
      });
      
      // Remove instances for disabled base metrics
      const filtered = updated.filter(inst => 
        enabled.some(m => m.id === inst.baseMetricId)
      );
      
      if (JSON.stringify(filtered) !== JSON.stringify(prevInstances)) {
        localStorage.setItem(METRIC_INSTANCES_KEY, JSON.stringify(filtered));
        return filtered;
      }
      
      return prevInstances;
    });
    
    setEnabledMetrics(enabled);
  }, [configKey, metricsConfigHook]);
  
  useEffect(() => {
    // Re-read from localStorage when configKey changes (includes color range changes)
    const saved = localStorage.getItem("tradebutler_metrics_config");
    if (saved) {
      try {
        const allMetrics = JSON.parse(saved);
        const enabled = allMetrics.filter((m: any) => m.enabled);
        setEnabledMetrics(enabled);
        
        // Sync instances
        const currentInstances = JSON.parse(localStorage.getItem(METRIC_INSTANCES_KEY) || "[]");
        const enabledIds = enabled.map((m: any) => m.id);
        
        // Ensure each enabled metric has at least one instance
        const updatedInstances: MetricInstance[] = [];
        enabled.forEach((baseMetric: any) => {
          const existing = currentInstances.filter((inst: MetricInstance) => inst.baseMetricId === baseMetric.id);
          if (existing.length > 0) {
            updatedInstances.push(...existing);
          } else {
            updatedInstances.push({
              instanceId: baseMetric.id,
              baseMetricId: baseMetric.id,
              strategyFilterId: null,
            });
          }
        });
        
        // Remove instances for disabled metrics
        const filteredInstances = updatedInstances.filter(inst => enabledIds.includes(inst.baseMetricId));
        setMetricInstances(filteredInstances);
        localStorage.setItem(METRIC_INSTANCES_KEY, JSON.stringify(filteredInstances));
        
        // Initialize or update metric card order based on instances
        const currentOrder = localStorage.getItem(METRIC_CARDS_ORDER_KEY);
        const instanceIds = filteredInstances.map(inst => inst.instanceId);
        
        if (!currentOrder || currentOrder === "[]") {
          // Initialize with current instances
          setMetricCardOrder(instanceIds);
          localStorage.setItem(METRIC_CARDS_ORDER_KEY, JSON.stringify(instanceIds));
        } else {
          // Update order to include any new instances and remove deleted ones
          const savedOrder: string[] = JSON.parse(currentOrder);
          const newOrder = [...savedOrder];
          
          // Add any missing instance IDs to the end
          instanceIds.forEach((id: string) => {
            if (!newOrder.includes(id)) {
              newOrder.push(id);
            }
          });
          
          // Remove any IDs that are no longer valid instances
          const filteredOrder = newOrder.filter((id: string) => instanceIds.includes(id));
          
          if (JSON.stringify(filteredOrder) !== JSON.stringify(metricCardOrder)) {
            setMetricCardOrder(filteredOrder);
            localStorage.setItem(METRIC_CARDS_ORDER_KEY, JSON.stringify(filteredOrder));
          }
        }
      } catch {
        const enabled = metricsConfigHook.getEnabledMetrics();
        setEnabledMetrics(enabled);
        const instances = enabled.map(m => ({
          instanceId: m.id,
          baseMetricId: m.id,
          strategyFilterId: null,
        }));
        setMetricInstances(instances);
        localStorage.setItem(METRIC_INSTANCES_KEY, JSON.stringify(instances));
        const order = instances.map(inst => inst.instanceId);
        setMetricCardOrder(order);
        localStorage.setItem(METRIC_CARDS_ORDER_KEY, JSON.stringify(order));
      }
    } else {
      const enabled = metricsConfigHook.getEnabledMetrics();
      setEnabledMetrics(enabled);
      const instances = enabled.map(m => ({
        instanceId: m.id,
        baseMetricId: m.id,
        strategyFilterId: null,
      }));
      setMetricInstances(instances);
      localStorage.setItem(METRIC_INSTANCES_KEY, JSON.stringify(instances));
      const order = instances.map(inst => inst.instanceId);
      setMetricCardOrder(order);
      localStorage.setItem(METRIC_CARDS_ORDER_KEY, JSON.stringify(order));
    }
  }, [configKey, metricsConfigHook]);

  // Sync metric card order when instances change
  useEffect(() => {
    const instanceIds = metricInstances.map(inst => inst.instanceId);
    if (instanceIds.length === 0) return;
    
    setMetricCardOrder(prevOrder => {
      const newOrder = [...prevOrder];
      
      // Add any missing instance IDs to the end
      instanceIds.forEach(id => {
        if (!newOrder.includes(id)) {
          newOrder.push(id);
        }
      });
      
      // Remove any IDs that are no longer valid instances
      const filteredOrder = newOrder.filter(id => instanceIds.includes(id));
      
      // Only update if order actually changed
      if (JSON.stringify(filteredOrder) !== JSON.stringify(prevOrder)) {
        localStorage.setItem(METRIC_CARDS_ORDER_KEY, JSON.stringify(filteredOrder));
        return filteredOrder;
      }
      return prevOrder;
    });
  }, [metricInstances]); // Only run when metricInstances changes

  // Create display metrics from instances
  const displayMetrics = useMemo(() => {
    return metricInstances
      .filter(inst => {
        // Only show instances whose base metric is enabled
        return enabledMetrics.some(m => m.id === inst.baseMetricId);
      })
      .map(inst => {
        const baseMetric = enabledMetrics.find(m => m.id === inst.baseMetricId);
        if (!baseMetric) return null;
        return {
          ...baseMetric,
          id: inst.instanceId, // Use instance ID instead of base ID
          baseMetricId: inst.baseMetricId, // Keep reference to base
        };
      })
      .filter((m): m is any => m !== null);
  }, [metricInstances, enabledMetrics]);

  // Sort metrics by saved order using useMemo
  const sortedMetrics = useMemo(() => {
    return [...displayMetrics].sort((a, b) => {
      const aIndex = metricCardOrder.indexOf(a.id);
      const bIndex = metricCardOrder.indexOf(b.id);
      
      // If both are in the order, sort by their position
      if (aIndex !== -1 && bIndex !== -1) {
        return aIndex - bIndex;
      }
      // If only one is in the order, prioritize it
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      // If neither is in the order, maintain original order
      return 0;
    });
  }, [displayMetrics, metricCardOrder]);
  
  // Listen for color range changes - use a ref to track previous value
  const prevColorRangeRef = useRef<string>("");
  useEffect(() => {
    const checkColorRange = () => {
      const currentRange = localStorage.getItem("tradebutler_color_range");
      if (currentRange && currentRange !== prevColorRangeRef.current) {
        prevColorRangeRef.current = currentRange;
        setConfigKey(prev => prev + 1);
      }
    };
    
    // Check immediately
    checkColorRange();
    
    // Check periodically for localStorage changes
    const interval = setInterval(checkColorRange, 300);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    loadDashboardData();
    // Reset to first page when timeframe changes
    setCurrentTradesPage(1);
  }, [timeframe, customStartDate, customEndDate]);
  
  useEffect(() => {
    localStorage.setItem("tradebutler_dashboard_timeframe", timeframe);
  }, [timeframe]);
  
  useEffect(() => {
    if (customStartDate) {
      localStorage.setItem("tradebutler_dashboard_custom_start", customStartDate);
    } else {
      localStorage.removeItem("tradebutler_dashboard_custom_start");
    }
    if (customEndDate) {
      localStorage.setItem("tradebutler_dashboard_custom_end", customEndDate);
    } else {
      localStorage.removeItem("tradebutler_dashboard_custom_end");
    }
  }, [customStartDate, customEndDate]);

  // Re-read dashboard sections from localStorage when config changes
  useEffect(() => {
    const saved = localStorage.getItem(DASHBOARD_SECTIONS_KEY);
    if (saved) {
      try {
        const newSections = { ...defaultDashboardSections, ...JSON.parse(saved) };
        setDashboardSections(newSections);
        
        // Ensure all enabled sections are in the sectionOrder
        const allSections: SectionId[] = ["topSymbols", "strategyPerformance", "recentTrades", "trades"];
        setSectionOrder(prevOrder => {
          const enabledSections = allSections.filter(id => {
            const key = `show${id.charAt(0).toUpperCase() + id.slice(1)}` as keyof typeof newSections;
            return newSections[key] !== false;
          });
          
          // Keep existing order for sections that are still enabled, add new ones at the end
          const existingOrder = prevOrder.filter(id => enabledSections.includes(id));
          const missing = enabledSections.filter(id => !existingOrder.includes(id));
          const newOrder = [...existingOrder, ...missing];
          
          if (JSON.stringify(newOrder) !== JSON.stringify(prevOrder)) {
            localStorage.setItem(DASHBOARD_SECTION_ORDER_KEY, JSON.stringify(newOrder));
            return newOrder;
          }
          return prevOrder;
        });
      } catch {
        // Keep current state
      }
    }
  }, [configKey]);

  const loadDashboardData = async () => {
    setLoading(true);
    try {
      const pairingMethod = localStorage.getItem("tradebutler_pairing_method") || "FIFO";
      const dateRange = getTimeframeDates(timeframe, customStartDate, customEndDate);
      const startDate = dateRange.start ? dateRange.start.toISOString() : null;
      const endDate = dateRange.end ? dateRange.end.toISOString() : null;
      
      const [metricsData, pnlData, strategiesData, tradesData, allTradesData, strategiesList] = await Promise.all([
        invoke<Metrics>("get_metrics", { pairingMethod, startDate, endDate }),
        invoke<SymbolPnL[]>("get_symbol_pnl", { pairingMethod, startDate, endDate }),
        invoke<StrategyPerformance[]>("get_strategy_performance", { pairingMethod, startDate, endDate }),
        invoke<RecentTrade[]>("get_recent_trades", { limit: 5, pairingMethod, startDate, endDate }),
        invoke<RecentTrade[]>("get_recent_trades", { limit: 10000, pairingMethod, startDate, endDate }),
        invoke<Strategy[]>("get_strategies"),
      ]);
      setMetrics(metricsData);
      setStrategies(strategiesList);
      
      // Convert SymbolPnL to TopSymbol format for display
      const topSymbolsData = pnlData
        .slice(0, 5)
        .map((pnl) => ({
          symbol: pnl.symbol,
          trade_count: pnl.closed_positions,
          total_volume: 0, // We don't track volume separately
          estimated_pnl: pnl.total_net_pnl,
        }));
      setTopSymbols(topSymbolsData);
      setStrategyPerformance(strategiesData);
      setRecentTrades(tradesData);
      // Sort all trades by exit timestamp (most recent first)
      const sortedTrades = [...allTradesData].sort((a, b) => 
        new Date(b.exit_timestamp).getTime() - new Date(a.exit_timestamp).getTime()
      );
      setTrades(sortedTrades);
    } catch (error) {
      console.error("Error loading dashboard data:", error);
    } finally {
      setLoading(false);
    }
  };

  // Calculate strategy-filtered metrics
  const [filteredStrategyMetrics, setFilteredStrategyMetrics] = useState<Record<string, number>>({});
  
  useEffect(() => {
    let cancelled = false;
    
    const calculateFilteredMetrics = async () => {
      const strategyMetrics = [
        "strategy_win_rate",
        "strategy_winning_trades",
        "strategy_losing_trades",
        "strategy_profit_loss",
        "strategy_consecutive_wins",
        "strategy_consecutive_losses",
      ];
      
      const newFilteredMetrics: Record<string, number> = {};
      
      // Group instances by strategy ID to batch API calls
      const instancesByStrategy = new Map<number, Array<{ instance: MetricInstance; baseMetricId: string }>>();
      
      for (const instance of metricInstances) {
        if (!strategyMetrics.includes(instance.baseMetricId)) continue;
        
        // Only use instanceId for the filter - never fall back to baseMetricId
        const selectedStrategyId = strategyFilterForMetrics[instance.instanceId];
        // If null or undefined, explicitly don't add to newFilteredMetrics (will use global metrics instead)
        if (selectedStrategyId === null || selectedStrategyId === undefined) {
          continue;
        }
        
        if (!instancesByStrategy.has(selectedStrategyId)) {
          instancesByStrategy.set(selectedStrategyId, []);
        }
        instancesByStrategy.get(selectedStrategyId)!.push({ instance, baseMetricId: instance.baseMetricId });
      }
      
      // Process in batches to avoid too many simultaneous API calls
      const BATCH_SIZE = 3;
      const strategyIds = Array.from(instancesByStrategy.keys());
      
      for (let i = 0; i < strategyIds.length; i += BATCH_SIZE) {
        if (cancelled) return;
        
        const batch = strategyIds.slice(i, i + BATCH_SIZE);
        const batchPromises = batch.map(async (selectedStrategyId) => {
          try {
            const pairingMethod = localStorage.getItem("tradebutler_pairing_method") || "FIFO";
            const dateRange = getTimeframeDates(timeframe, customStartDate, customEndDate);
            const startDate = dateRange.start ? dateRange.start.toISOString() : null;
            const endDate = dateRange.end ? dateRange.end.toISOString() : null;
            
            const filteredPairs = await invoke<PairedTrade[]>("get_paired_trades_by_strategy", {
              strategyId: selectedStrategyId,
              pairingMethod,
              startDate,
              endDate,
            });
            
            // Calculate metrics for all instances using this strategy
            const instances = instancesByStrategy.get(selectedStrategyId)!;
            for (const { instance, baseMetricId } of instances) {
              if (baseMetricId === "strategy_win_rate") {
                const winning = filteredPairs.filter(p => p.net_profit_loss > 0).length;
                const total = filteredPairs.length;
                newFilteredMetrics[instance.instanceId] = total > 0 ? (winning / total) * 100 : 0;
              } else if (baseMetricId === "strategy_winning_trades") {
                newFilteredMetrics[instance.instanceId] = filteredPairs.filter(p => p.net_profit_loss > 0).length;
              } else if (baseMetricId === "strategy_losing_trades") {
                newFilteredMetrics[instance.instanceId] = filteredPairs.filter(p => p.net_profit_loss < 0).length;
              } else if (baseMetricId === "strategy_profit_loss") {
                newFilteredMetrics[instance.instanceId] = filteredPairs.reduce((sum, p) => sum + p.net_profit_loss, 0);
              } else if (baseMetricId === "strategy_consecutive_wins") {
                let maxStreak = 0;
                let currentStreak = 0;
                for (const pair of filteredPairs) {
                  if (pair.net_profit_loss > 0) {
                    currentStreak++;
                    maxStreak = Math.max(maxStreak, currentStreak);
                  } else {
                    currentStreak = 0;
                  }
                }
                newFilteredMetrics[instance.instanceId] = maxStreak;
              } else if (baseMetricId === "strategy_consecutive_losses") {
                let maxStreak = 0;
                let currentStreak = 0;
                for (const pair of filteredPairs) {
                  if (pair.net_profit_loss < 0) {
                    currentStreak++;
                    maxStreak = Math.max(maxStreak, currentStreak);
                  } else {
                    currentStreak = 0;
                  }
                }
                newFilteredMetrics[instance.instanceId] = maxStreak;
              }
            }
          } catch (error) {
            console.error(`Error calculating filtered metrics for strategy ${selectedStrategyId}:`, error);
            // Set fallback values for all instances using this strategy
            const instances = instancesByStrategy.get(selectedStrategyId)!;
            for (const { instance } of instances) {
              newFilteredMetrics[instance.instanceId] = metrics?.[instance.baseMetricId as keyof Metrics] as number || 0;
            }
          }
        });
        
        await Promise.all(batchPromises);
        
        // Small delay between batches to prevent overwhelming the backend
        if (i + BATCH_SIZE < strategyIds.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      if (!cancelled) {
        setFilteredStrategyMetrics(newFilteredMetrics);
      }
    };
    
    calculateFilteredMetrics();
    
    return () => {
      cancelled = true;
    };
  }, [strategyFilterForMetrics, timeframe, customStartDate, customEndDate, metrics, metricInstances]);

  if (loading) {
    return (
      <div style={{ padding: "40px", textAlign: "center" }}>
        <p>Loading metrics...</p>
      </div>
    );
  }

  const metricValues: Record<string, number> = {
    total_trades: metrics?.total_trades || 0,
    total_volume: metrics?.total_volume || 0,
    total_profit_loss: metrics?.total_profit_loss || 0,
    win_rate: metrics?.win_rate || 0,
    winning_trades: metrics?.winning_trades || 0,
    losing_trades: metrics?.losing_trades || 0,
    average_profit: metrics?.average_profit || 0,
    average_loss: metrics?.average_loss || 0,
    largest_win: metrics?.largest_win || 0,
    largest_loss: metrics?.largest_loss || 0,
    consecutive_wins: metrics?.consecutive_wins || 0,
    consecutive_losses: metrics?.consecutive_losses || 0,
    current_win_streak: metrics?.current_win_streak || 0,
    current_loss_streak: metrics?.current_loss_streak || 0,
    strategy_win_rate: filteredStrategyMetrics.strategy_win_rate !== undefined 
      ? filteredStrategyMetrics.strategy_win_rate 
      : (metrics?.strategy_win_rate || 0),
    strategy_winning_trades: filteredStrategyMetrics.strategy_winning_trades !== undefined 
      ? filteredStrategyMetrics.strategy_winning_trades 
      : (metrics?.strategy_winning_trades || 0),
    strategy_losing_trades: filteredStrategyMetrics.strategy_losing_trades !== undefined 
      ? filteredStrategyMetrics.strategy_losing_trades 
      : (metrics?.strategy_losing_trades || 0),
    strategy_profit_loss: filteredStrategyMetrics.strategy_profit_loss !== undefined 
      ? filteredStrategyMetrics.strategy_profit_loss 
      : (metrics?.strategy_profit_loss || 0),
    strategy_consecutive_wins: filteredStrategyMetrics.strategy_consecutive_wins !== undefined 
      ? filteredStrategyMetrics.strategy_consecutive_wins 
      : (metrics?.strategy_consecutive_wins || 0),
    strategy_consecutive_losses: filteredStrategyMetrics.strategy_consecutive_losses !== undefined 
      ? filteredStrategyMetrics.strategy_consecutive_losses 
      : (metrics?.strategy_consecutive_losses || 0),
    expectancy: metrics?.expectancy || 0,
    profit_factor: metrics?.profit_factor || 0,
    average_trade: metrics?.average_trade || 0,
    total_fees: metrics?.total_fees || 0,
    net_profit: metrics?.net_profit || 0,
    max_drawdown: metrics?.max_drawdown || 0,
    sharpe_ratio: metrics?.sharpe_ratio || 0,
    risk_reward_ratio: metrics?.risk_reward_ratio || 0,
    trades_per_day: metrics?.trades_per_day || 0,
    best_day: metrics?.best_day || 0,
    worst_day: metrics?.worst_day || 0,
    average_holding_time_seconds: metrics?.average_holding_time_seconds || 0,
  };

  return (
    <div style={{ padding: "30px", overflowY: "auto", height: "100%" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "20px",
            }}
          >
            <h1 style={{ fontSize: "32px", fontWeight: "bold" }}>Dashboard</h1>
            <button
              onClick={() => setShowMetricsConfig(true)}
              style={{
                background: "var(--bg-secondary)",
                border: "1px solid var(--border-color)",
                borderRadius: "8px",
                padding: "10px 16px",
                color: "var(--text-primary)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "14px",
              }}
            >
              <Settings size={16} />
              Configure
            </button>
          </div>
          <div style={{ marginBottom: "30px" }}>
            <TimeframeSelector
              value={timeframe}
              onChange={setTimeframe}
              customStartDate={customStartDate}
              customEndDate={customEndDate}
              onCustomDatesChange={(start, end) => {
                // Ensure we save the dates immediately
                setCustomStartDate(start || "");
                setCustomEndDate(end || "");
                // Also save directly to localStorage to ensure persistence
                if (start) {
                  localStorage.setItem("tradebutler_dashboard_custom_start", start);
                } else {
                  localStorage.removeItem("tradebutler_dashboard_custom_start");
                }
                if (end) {
                  localStorage.setItem("tradebutler_dashboard_custom_end", end);
                } else {
                  localStorage.removeItem("tradebutler_dashboard_custom_end");
                }
              }}
            />
          </div>

      {/* Metrics Cards */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={sortedMetrics.map(m => m.id)}
          strategy={rectSortingStrategy}
        >
      <div
        style={{
          display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: "20px",
          marginBottom: "30px",
        }}
      >
        {sortedMetrics.map((metric) => {
          // Get base metric ID for value lookup
          const baseMetricId = (metric as any).baseMetricId || metric.id;
          const value = filteredStrategyMetrics[metric.id] !== undefined 
            ? filteredStrategyMetrics[metric.id]
            : (metricValues[baseMetricId] || 0);
          const Icon = metricIcons[baseMetricId] || Activity;
          const color = getMetricColor(baseMetricId, value);

          return (
            <SortableMetricCard
              key={metric.id}
              id={metric.id}
              metric={metric}
              value={value}
              Icon={Icon}
              color={color}
              metrics={metrics}
              formatMetricValue={formatMetricValue}
              setTimeframe={setTimeframe}
              setCustomStartDate={setCustomStartDate}
              setCustomEndDate={setCustomEndDate}
              setSelectedPositionGroupId={setSelectedPositionGroupId}
              setShowPositionGroupModal={setShowPositionGroupModal}
              setSelectedPositionGroup={setSelectedPositionGroup}
              openMetricSettings={openMetricSettings}
              setOpenMetricSettings={setOpenMetricSettings}
              metricMenuPosition={metricMenuPosition}
              setMetricMenuPosition={setMetricMenuPosition}
              sortedMetrics={sortedMetrics}
              enabledMetrics={enabledMetrics}
              setMetricCardOrder={setMetricCardOrder}
              strategies={strategies}
              strategyFilterForMetrics={strategyFilterForMetrics}
              setStrategyFilterForMetrics={setStrategyFilterForMetrics}
              duplicateMetricInstance={duplicateMetricInstance}
              removeMetricInstance={removeMetricInstance}
              setMetricInstances={setMetricInstances}
            />
          );
        })}
      </div>
        </SortableContext>
      </DndContext>

      {/* Dashboard Stats Grid */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleSectionDragEnd}
      >
        <SortableContext
          items={sectionOrder}
          strategy={rectSortingStrategy}
        >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))",
          gap: "20px",
          marginBottom: "30px",
        }}
      >
        {sectionOrder.map((sectionId) => {
          // Top Symbols
          if (sectionId === "topSymbols" && dashboardSections.showTopSymbols && topSymbols.length > 0) {
            return (
              <SortableSection key="topSymbols" id="topSymbols">
                {({ dragHandleProps, isDragging }) => (
                  <div
                    style={{
                      backgroundColor: "var(--bg-secondary)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "8px",
                      padding: "20px",
                      cursor: isDragging ? "grabbing" : "grab",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div {...dragHandleProps} style={{ cursor: "grab" }}>
                          <GripVertical size={16} color="var(--text-secondary)" />
                        </div>
                  <BarChart3 size={20} color="var(--accent)" />
                  <h2 style={{ fontSize: "20px", fontWeight: "600" }}>Top Symbols</h2>
                  </div>
                  <div style={{ position: "relative" }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                  e.preventDefault();
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setSectionMenuPosition({
                          ...sectionMenuPosition,
                          topSymbols: {
                            top: rect.bottom + 4,
                            right: window.innerWidth - rect.right,
                          },
                        });
                        setOpenSectionSettings(openSectionSettings === "topSymbols" ? null : "topSymbols");
                      }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                      }}
                      style={{
                        background: "transparent",
                        border: "none",
                        padding: "4px",
                        cursor: "pointer",
                        color: "var(--text-secondary)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: "4px",
                      }}
                      title="Settings"
                    >
                      <Settings size={16} />
                    </button>
                    {openSectionSettings === "topSymbols" && createPortal(
                      <div
                        data-settings-menu
                        style={{
                          position: "fixed",
                          top: `${sectionMenuPosition.topSymbols.top}px`,
                          right: `${sectionMenuPosition.topSymbols.right}px`,
                          backgroundColor: "var(--bg-secondary)",
                          border: "1px solid var(--border-color)",
                          borderRadius: "8px",
                          padding: "8px",
                          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
                          zIndex: 99999,
                          minWidth: "120px",
                        }}
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                  e.preventDefault();
                              const currentIndex = sectionOrder.indexOf("topSymbols");
                              if (currentIndex > 0) {
                    const newOrder = [...sectionOrder];
                                [newOrder[currentIndex - 1], newOrder[currentIndex]] = [newOrder[currentIndex], newOrder[currentIndex - 1]];
                    setSectionOrder(newOrder);
                    localStorage.setItem(DASHBOARD_SECTION_ORDER_KEY, JSON.stringify(newOrder));
                  }
                              setOpenSectionSettings(null);
                            }}
                            disabled={sectionOrder.indexOf("topSymbols") === 0}
                            style={{
                              background: "transparent",
                              border: "1px solid var(--border-color)",
                              borderRadius: "4px",
                              padding: "6px 8px",
                              cursor: sectionOrder.indexOf("topSymbols") === 0 ? "not-allowed" : "pointer",
                              color: "var(--text-primary)",
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                              fontSize: "13px",
                              opacity: sectionOrder.indexOf("topSymbols") === 0 ? 0.3 : 1,
                            }}
                          >
                            <ChevronUp size={14} />
                            <span>Move Up</span>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              const currentIndex = sectionOrder.indexOf("topSymbols");
                              if (currentIndex < sectionOrder.length - 1) {
                                const newOrder = [...sectionOrder];
                                [newOrder[currentIndex], newOrder[currentIndex + 1]] = [newOrder[currentIndex + 1], newOrder[currentIndex]];
                                setSectionOrder(newOrder);
                                localStorage.setItem(DASHBOARD_SECTION_ORDER_KEY, JSON.stringify(newOrder));
                              }
                              setOpenSectionSettings(null);
                            }}
                            disabled={sectionOrder.indexOf("topSymbols") === sectionOrder.length - 1}
                style={{
                              background: "transparent",
                  border: "1px solid var(--border-color)",
                              borderRadius: "4px",
                              padding: "6px 8px",
                              cursor: sectionOrder.indexOf("topSymbols") === sectionOrder.length - 1 ? "not-allowed" : "pointer",
                              color: "var(--text-primary)",
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                              fontSize: "13px",
                              opacity: sectionOrder.indexOf("topSymbols") === sectionOrder.length - 1 ? 0.3 : 1,
                            }}
                          >
                            <ChevronDown size={14} />
                            <span>Move Down</span>
                          </button>
                        </div>
                      </div>,
                      document.body
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {topSymbols.map((symbol) => (
                    <div
                      key={symbol.symbol}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "12px",
                        backgroundColor: "var(--bg-tertiary)",
                        borderRadius: "6px",
                      }}
                    >
                      <div>
                        <p style={{ fontWeight: "600", marginBottom: "4px" }}>{symbol.symbol}</p>
                        <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                          {symbol.trade_count} trades
                        </p>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <p
                          style={{
                            fontWeight: "600",
                            color: symbol.estimated_pnl >= 0 ? "var(--profit)" : "var(--loss)",
                          }}
                        >
                          ${symbol.estimated_pnl.toFixed(2)}
                        </p>
                        <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                          {symbol.trade_count} {symbol.trade_count === 1 ? "trade" : "trades"}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
                )}
              </SortableSection>
            );
          }

          // Strategy Performance
          if (sectionId === "strategyPerformance" && dashboardSections.showStrategyPerformance && strategyPerformance.length > 0) {
            return (
              <SortableSection key="strategyPerformance" id="strategyPerformance">
                {({ dragHandleProps, isDragging }) => (
                  <div
                    style={{
                      backgroundColor: "var(--bg-secondary)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "8px",
                      padding: "20px",
                      cursor: isDragging ? "grabbing" : "grab",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div {...dragHandleProps} style={{ cursor: "grab" }}>
                          <GripVertical size={16} color="var(--text-secondary)" />
                        </div>
                  <TrendingUpIcon size={20} color="var(--accent)" />
                  <h2 style={{ fontSize: "20px", fontWeight: "600" }}>Strategy Performance</h2>
                  </div>
                  <div style={{ position: "relative" }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                  e.preventDefault();
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setSectionMenuPosition({
                          ...sectionMenuPosition,
                          strategyPerformance: {
                            top: rect.bottom + 4,
                            right: window.innerWidth - rect.right,
                          },
                        });
                        setOpenSectionSettings(openSectionSettings === "strategyPerformance" ? null : "strategyPerformance");
                      }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                      }}
                      style={{
                        background: "transparent",
                        border: "none",
                        padding: "4px",
                        cursor: "pointer",
                        color: "var(--text-secondary)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: "4px",
                      }}
                      title="Settings"
                    >
                      <Settings size={16} />
                    </button>
                    {openSectionSettings === "strategyPerformance" && createPortal(
                      <div
                        data-settings-menu
                        style={{
                          position: "fixed",
                          top: `${sectionMenuPosition.strategyPerformance.top}px`,
                          right: `${sectionMenuPosition.strategyPerformance.right}px`,
                          backgroundColor: "var(--bg-secondary)",
                          border: "1px solid var(--border-color)",
                          borderRadius: "8px",
                          padding: "8px",
                          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
                          zIndex: 99999,
                          minWidth: "120px",
                        }}
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                  e.preventDefault();
                              const currentIndex = sectionOrder.indexOf("strategyPerformance");
                              if (currentIndex > 0) {
                    const newOrder = [...sectionOrder];
                                [newOrder[currentIndex - 1], newOrder[currentIndex]] = [newOrder[currentIndex], newOrder[currentIndex - 1]];
                    setSectionOrder(newOrder);
                    localStorage.setItem(DASHBOARD_SECTION_ORDER_KEY, JSON.stringify(newOrder));
                  }
                              setOpenSectionSettings(null);
                            }}
                            disabled={sectionOrder.indexOf("strategyPerformance") === 0}
                            style={{
                              background: "transparent",
                              border: "1px solid var(--border-color)",
                              borderRadius: "4px",
                              padding: "6px 8px",
                              cursor: sectionOrder.indexOf("strategyPerformance") === 0 ? "not-allowed" : "pointer",
                              color: "var(--text-primary)",
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                              fontSize: "13px",
                              opacity: sectionOrder.indexOf("strategyPerformance") === 0 ? 0.3 : 1,
                            }}
                          >
                            <ChevronUp size={14} />
                            <span>Move Up</span>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              const currentIndex = sectionOrder.indexOf("strategyPerformance");
                              if (currentIndex < sectionOrder.length - 1) {
                                const newOrder = [...sectionOrder];
                                [newOrder[currentIndex], newOrder[currentIndex + 1]] = [newOrder[currentIndex + 1], newOrder[currentIndex]];
                                setSectionOrder(newOrder);
                                localStorage.setItem(DASHBOARD_SECTION_ORDER_KEY, JSON.stringify(newOrder));
                              }
                              setOpenSectionSettings(null);
                            }}
                            disabled={sectionOrder.indexOf("strategyPerformance") === sectionOrder.length - 1}
                style={{
                              background: "transparent",
                  border: "1px solid var(--border-color)",
                              borderRadius: "4px",
                              padding: "6px 8px",
                              cursor: sectionOrder.indexOf("strategyPerformance") === sectionOrder.length - 1 ? "not-allowed" : "pointer",
                              color: "var(--text-primary)",
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                              fontSize: "13px",
                              opacity: sectionOrder.indexOf("strategyPerformance") === sectionOrder.length - 1 ? 0.3 : 1,
                            }}
                          >
                            <ChevronDown size={14} />
                            <span>Move Down</span>
                          </button>
                          <div style={{ borderTop: "1px solid var(--border-color)", margin: "4px 0" }} />
                          <div style={{ padding: "8px", display: "flex", flexDirection: "column", gap: "8px" }}>
                            <label style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>
                              Pairs Per Page:
                            </label>
                            <input
                              type="number"
                              min="5"
                              max="100"
                              step="5"
                              value={strategyPairsPerPage}
                              onChange={(e) => {
                                const value = Math.max(5, Math.min(100, parseInt(e.target.value) || 20));
                                setStrategyPairsPerPage(value);
                                localStorage.setItem("tradebutler_strategy_pairs_per_page", value.toString());
                                // Reset all strategy pages to 1 when changing page size
                                setStrategyCurrentPages(new Map());
                              }}
                              onClick={(e) => e.stopPropagation()}
                              style={{
                                padding: "6px 8px",
                                backgroundColor: "var(--bg-tertiary)",
                                border: "1px solid var(--border-color)",
                                borderRadius: "4px",
                                color: "var(--text-primary)",
                                fontSize: "13px",
                                width: "100%",
                              }}
                            />
                          </div>
                        </div>
                      </div>,
                      document.body
                    )}
                  </div>
                </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {strategyPerformance.map((strategy) => {
                const strategyKey = strategy.strategy_id ?? "unassigned";
                const isExpanded = expandedStrategies.has(strategyKey);
                const pairs = strategyPairs.get(strategyKey) || [];
                const isLoading = loadingStrategyPairs.has(strategyKey);
                
                // Calculate statistics from pairs (use pairs if loaded, otherwise use strategy data)
                const totalTrades = pairs.length > 0 ? pairs.length : strategy.trade_count;
                const totalPnL = pairs.length > 0 
                  ? pairs.reduce((sum, pair) => sum + pair.net_profit_loss, 0)
                  : strategy.estimated_pnl;
                const winningTrades = pairs.filter(pair => pair.net_profit_loss > 0).length;
                const winPercentage = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
                
                return (
                <div
                    key={strategyKey}
                    style={{
                      backgroundColor: "var(--bg-tertiary)",
                      borderRadius: "6px",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      onClick={async () => {
                        const newExpanded = new Set(expandedStrategies);
                        if (newExpanded.has(strategyKey)) {
                          newExpanded.delete(strategyKey);
                        } else {
                          newExpanded.add(strategyKey);
                          // Reset to page 1 when expanding
                          const newPages = new Map(strategyCurrentPages);
                          newPages.set(strategyKey, 1);
                          setStrategyCurrentPages(newPages);
                          // Load pairs if not already loaded
                          if (!strategyPairs.has(strategyKey)) {
                            setLoadingStrategyPairs(new Set([...loadingStrategyPairs, strategyKey]));
                            try {
                              const pairingMethod = localStorage.getItem("tradebutler_pairing_method") || "FIFO";
                              const dateRange = getTimeframeDates(timeframe, customStartDate, customEndDate);
                              const startDate = dateRange.start ? dateRange.start.toISOString() : null;
                              const endDate = dateRange.end ? dateRange.end.toISOString() : null;
                              const loadedPairs = await invoke<PairedTrade[]>("get_paired_trades_by_strategy", {
                                strategyId: strategy.strategy_id,
                                pairingMethod: pairingMethod,
                                startDate: startDate,
                                endDate: endDate,
                              });
                              setStrategyPairs(new Map(strategyPairs.set(strategyKey, loadedPairs)));
                            } catch (error) {
                              console.error("Error loading strategy pairs:", error);
                            } finally {
                              const newLoading = new Set(loadingStrategyPairs);
                              newLoading.delete(strategyKey);
                              setLoadingStrategyPairs(newLoading);
                            }
                          }
                        }
                        setExpandedStrategies(newExpanded);
                      }}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "12px",
                        cursor: "pointer",
                  }}
                >
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1 }}>
                        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <div style={{ flex: 1 }}>
                    <p style={{ fontWeight: "600", marginBottom: "4px" }}>{strategy.strategy_name}</p>
                    {!isExpanded && (
                      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
                    <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                          {totalTrades} trades
                        </p>
                        <p style={{ 
                          fontSize: "12px", 
                          color: totalPnL >= 0 ? "var(--profit)" : "var(--loss)",
                          fontWeight: "500"
                        }}>
                          ${totalPnL >= 0 ? "+" : ""}{totalPnL.toFixed(2)} P&L
                        </p>
                        {pairs.length > 0 && (
                          <p style={{ 
                            fontSize: "12px", 
                            color: winPercentage >= 50 ? "var(--profit)" : winPercentage > 0 ? "var(--text-secondary)" : "var(--loss)",
                            fontWeight: "500"
                          }}>
                            {winPercentage.toFixed(1)}% win
                          </p>
                        )}
                      </div>
                    )}
                        </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <p
                      style={{
                        fontWeight: "600",
                        color: totalPnL >= 0 ? "var(--profit)" : "var(--loss)",
                      }}
                    >
                      ${totalPnL.toFixed(2)}
                    </p>
                    <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                      ${(strategy.total_volume / 1000).toFixed(1)}k vol
                    </p>
                  </div>
                </div>
                    {isExpanded && (
                      <div
                        style={{
                          borderTop: "1px solid var(--border-color)",
                          padding: "16px",
                          backgroundColor: "var(--bg-secondary)",
                        }}
                      >
                        {isLoading ? (
                          <p style={{ color: "var(--text-secondary)", textAlign: "center" }}>Loading trade pairs...</p>
                        ) : pairs.length === 0 ? (
                          <p style={{ color: "var(--text-secondary)", textAlign: "center" }}>No trade pairs found for this strategy.</p>
                        ) : (() => {
                          // Calculate pagination
                          const currentPage = strategyCurrentPages.get(strategyKey) || 1;
                          const totalPages = Math.ceil(pairs.length / strategyPairsPerPage);
                          const startIndex = (currentPage - 1) * strategyPairsPerPage;
                          const endIndex = startIndex + strategyPairsPerPage;
                          const paginatedPairs = pairs.slice(startIndex, endIndex);
                          
                          return (
                            <>
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
                                    {paginatedPairs.map((pair, idx) => (
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
                              {totalPages > 1 && (
                                <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "12px", marginTop: "16px", paddingTop: "16px", borderTop: "1px solid var(--border-color)" }}>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const newPages = new Map(strategyCurrentPages);
                                      newPages.set(strategyKey, Math.max(1, currentPage - 1));
                                      setStrategyCurrentPages(newPages);
                                    }}
                                    disabled={currentPage === 1}
                                    style={{
                                      padding: "6px 12px",
                                      backgroundColor: currentPage === 1 ? "var(--bg-tertiary)" : "var(--bg-secondary)",
                                      border: "1px solid var(--border-color)",
                                      borderRadius: "4px",
                                      color: "var(--text-primary)",
                                      cursor: currentPage === 1 ? "not-allowed" : "pointer",
                                      fontSize: "13px",
                                      opacity: currentPage === 1 ? 0.5 : 1,
                                    }}
                                  >
                                    Previous
                                  </button>
                                  <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
                                    Page {currentPage} of {totalPages}
                                  </span>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const newPages = new Map(strategyCurrentPages);
                                      newPages.set(strategyKey, Math.min(totalPages, currentPage + 1));
                                      setStrategyCurrentPages(newPages);
                                    }}
                                    disabled={currentPage === totalPages}
                                    style={{
                                      padding: "6px 12px",
                                      backgroundColor: currentPage === totalPages ? "var(--bg-tertiary)" : "var(--bg-secondary)",
                                      border: "1px solid var(--border-color)",
                                      borderRadius: "4px",
                                      color: "var(--text-primary)",
                                      cursor: currentPage === totalPages ? "not-allowed" : "pointer",
                                      fontSize: "13px",
                                      opacity: currentPage === totalPages ? 0.5 : 1,
                                    }}
                                  >
                                    Next
                                  </button>
            </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                );
              })}
              </div>
                  </div>
                )}
              </SortableSection>
            );
          }

          // Recent Trades
          if (sectionId === "recentTrades" && dashboardSections.showRecentTrades && recentTrades.length > 0) {
            return (
              <SortableSection key="recentTrades" id="recentTrades">
                {({ dragHandleProps, isDragging }) => (
                  <div
                    style={{
                      backgroundColor: "var(--bg-secondary)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "8px",
                      padding: "20px",
                      cursor: isDragging ? "grabbing" : "grab",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div {...dragHandleProps} style={{ cursor: "grab" }}>
                          <GripVertical size={16} color="var(--text-secondary)" />
                        </div>
                  <Clock size={20} color="var(--accent)" />
                  <h2 style={{ fontSize: "20px", fontWeight: "600" }}>Recent Trades</h2>
                  </div>
                  <div style={{ position: "relative" }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                  e.preventDefault();
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setSectionMenuPosition({
                          ...sectionMenuPosition,
                          recentTrades: {
                            top: rect.bottom + 4,
                            right: window.innerWidth - rect.right,
                          },
                        });
                        setOpenSectionSettings(openSectionSettings === "recentTrades" ? null : "recentTrades");
                      }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                      }}
                      style={{
                        background: "transparent",
                        border: "none",
                        padding: "4px",
                        cursor: "pointer",
                        color: "var(--text-secondary)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: "4px",
                      }}
                      title="Settings"
                    >
                      <Settings size={16} />
                    </button>
                    {openSectionSettings === "recentTrades" && createPortal(
                      <div
                        data-settings-menu
                        style={{
                          position: "fixed",
                          top: `${sectionMenuPosition.recentTrades.top}px`,
                          right: `${sectionMenuPosition.recentTrades.right}px`,
                          backgroundColor: "var(--bg-secondary)",
                          border: "1px solid var(--border-color)",
                          borderRadius: "8px",
                          padding: "8px",
                          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
                          zIndex: 99999,
                          minWidth: "120px",
                        }}
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                  e.preventDefault();
                              const currentIndex = sectionOrder.indexOf("recentTrades");
                              if (currentIndex > 0) {
                    const newOrder = [...sectionOrder];
                                [newOrder[currentIndex - 1], newOrder[currentIndex]] = [newOrder[currentIndex], newOrder[currentIndex - 1]];
                    setSectionOrder(newOrder);
                    localStorage.setItem(DASHBOARD_SECTION_ORDER_KEY, JSON.stringify(newOrder));
                  }
                              setOpenSectionSettings(null);
                            }}
                            disabled={sectionOrder.indexOf("recentTrades") === 0}
                            style={{
                              background: "transparent",
                              border: "1px solid var(--border-color)",
                              borderRadius: "4px",
                              padding: "6px 8px",
                              cursor: sectionOrder.indexOf("recentTrades") === 0 ? "not-allowed" : "pointer",
                              color: "var(--text-primary)",
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                              fontSize: "13px",
                              opacity: sectionOrder.indexOf("recentTrades") === 0 ? 0.3 : 1,
                            }}
                          >
                            <ChevronUp size={14} />
                            <span>Move Up</span>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              const currentIndex = sectionOrder.indexOf("recentTrades");
                              if (currentIndex < sectionOrder.length - 1) {
                                const newOrder = [...sectionOrder];
                                [newOrder[currentIndex], newOrder[currentIndex + 1]] = [newOrder[currentIndex + 1], newOrder[currentIndex]];
                                setSectionOrder(newOrder);
                                localStorage.setItem(DASHBOARD_SECTION_ORDER_KEY, JSON.stringify(newOrder));
                              }
                              setOpenSectionSettings(null);
                            }}
                            disabled={sectionOrder.indexOf("recentTrades") === sectionOrder.length - 1}
                style={{
                              background: "transparent",
                  border: "1px solid var(--border-color)",
                              borderRadius: "4px",
                              padding: "6px 8px",
                              cursor: sectionOrder.indexOf("recentTrades") === sectionOrder.length - 1 ? "not-allowed" : "pointer",
                              color: "var(--text-primary)",
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                              fontSize: "13px",
                              opacity: sectionOrder.indexOf("recentTrades") === sectionOrder.length - 1 ? 0.3 : 1,
                            }}
                          >
                            <ChevronDown size={14} />
                            <span>Move Down</span>
                          </button>
                        </div>
                      </div>,
                      document.body
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {recentTrades.map((trade, idx) => {
                const isExpanded = expandedRecentTrades.has(idx);
                return (
                  <div key={`${trade.symbol}-${trade.exit_timestamp}-${idx}`}>
                    <div
                      onClick={() => {
                        const newExpanded = new Set(expandedRecentTrades);
                        if (isExpanded) {
                          newExpanded.delete(idx);
                        } else {
                          newExpanded.add(idx);
                        }
                        setExpandedRecentTrades(newExpanded);
                      }}
                      style={{
                        padding: "12px",
                        backgroundColor: "var(--bg-tertiary)",
                        borderRadius: "6px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                    >
                      {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      <div style={{ flex: 1, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <p style={{ fontWeight: "600" }}>{trade.symbol}</p>
                        <p
                          style={{
                            fontSize: "14px",
                            fontWeight: "600",
                            color: trade.net_profit_loss >= 0 ? "var(--profit)" : "var(--loss)",
                          }}
                        >
                          {trade.net_profit_loss >= 0 ? "+" : ""}${trade.net_profit_loss.toFixed(2)}
                        </p>
                      </div>
                    </div>
                    {isExpanded && (
                      <div
                        style={{
                          padding: "12px",
                          paddingLeft: "36px",
                          backgroundColor: "var(--bg-primary)",
                          borderBottomLeftRadius: "6px",
                          borderBottomRightRadius: "6px",
                          marginTop: "4px",
                        }}
                      >
                        <div style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ color: "var(--text-secondary)" }}>Entry:</span>
                            <span style={{ color: "var(--text-primary)" }}>
                              {trade.quantity} @ ${trade.entry_price.toFixed(2)}
                            </span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ color: "var(--text-secondary)" }}>Exit:</span>
                            <span style={{ color: "var(--text-primary)" }}>
                              {trade.quantity} @ ${trade.exit_price.toFixed(2)}
                            </span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ color: "var(--text-secondary)" }}>Closed:</span>
                            <span style={{ color: "var(--text-secondary)" }}>
                              {format(new Date(trade.exit_timestamp), "MMM d, HH:mm")}
                            </span>
                          </div>
                        </div>
                        {trade.strategy_name && (
                          <p style={{ fontSize: "11px", color: "var(--accent)", marginTop: "8px" }}>
                            {trade.strategy_name}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
                </div>
              </div>
                )}
              </SortableSection>
            );
          }
          
          // Trades Section
          if (sectionId === "trades" && dashboardSections.showTrades) {
            return (
              <SortableSection key="trades" id="trades">
                {({ dragHandleProps, isDragging }) => (
                  <div
                    style={{
                      backgroundColor: "var(--bg-secondary)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "8px",
                      padding: "20px",
                      cursor: isDragging ? "grabbing" : "grab",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div {...dragHandleProps} style={{ cursor: "grab" }}>
                          <GripVertical size={16} color="var(--text-secondary)" />
                        </div>
                    <Activity size={20} color="var(--accent)" />
                    <h2 style={{ fontSize: "20px", fontWeight: "600" }}>Trades</h2>
                  </div>
                  <div style={{ position: "relative" }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setSectionMenuPosition({
                          ...sectionMenuPosition,
                          trades: {
                            top: rect.bottom + 4,
                            right: window.innerWidth - rect.right,
                          },
                        });
                        setOpenSectionSettings(openSectionSettings === "trades" ? null : "trades");
                      }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                      }}
                      style={{
                        background: "transparent",
                        border: "none",
                        padding: "4px",
                        cursor: "pointer",
                        color: "var(--text-secondary)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: "4px",
                      }}
                      title="Settings"
                    >
                      <Settings size={16} />
                    </button>
                    {openSectionSettings === "trades" && createPortal(
                      <div
                        data-settings-menu
                        style={{
                          position: "fixed",
                          top: `${sectionMenuPosition.trades.top}px`,
                          right: `${sectionMenuPosition.trades.right}px`,
                          backgroundColor: "var(--bg-secondary)",
                          border: "1px solid var(--border-color)",
                          borderRadius: "8px",
                          padding: "8px",
                          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
                          zIndex: 99999,
                          minWidth: "120px",
                        }}
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              const currentIndex = sectionOrder.indexOf("trades");
                              if (currentIndex > 0) {
                                const newOrder = [...sectionOrder];
                                [newOrder[currentIndex - 1], newOrder[currentIndex]] = [newOrder[currentIndex], newOrder[currentIndex - 1]];
                                setSectionOrder(newOrder);
                                localStorage.setItem(DASHBOARD_SECTION_ORDER_KEY, JSON.stringify(newOrder));
                              }
                              setOpenSectionSettings(null);
                            }}
                            disabled={sectionOrder.indexOf("trades") === 0}
                            style={{
                              background: "transparent",
                              border: "1px solid var(--border-color)",
                              borderRadius: "4px",
                              padding: "6px 8px",
                              cursor: sectionOrder.indexOf("trades") === 0 ? "not-allowed" : "pointer",
                              color: "var(--text-primary)",
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                              fontSize: "13px",
                              opacity: sectionOrder.indexOf("trades") === 0 ? 0.3 : 1,
                            }}
                          >
                            <ChevronUp size={14} />
                            <span>Move Up</span>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              const currentIndex = sectionOrder.indexOf("trades");
                              if (currentIndex < sectionOrder.length - 1) {
                                const newOrder = [...sectionOrder];
                                [newOrder[currentIndex], newOrder[currentIndex + 1]] = [newOrder[currentIndex + 1], newOrder[currentIndex]];
                                setSectionOrder(newOrder);
                                localStorage.setItem(DASHBOARD_SECTION_ORDER_KEY, JSON.stringify(newOrder));
                              }
                              setOpenSectionSettings(null);
                            }}
                            disabled={sectionOrder.indexOf("trades") === sectionOrder.length - 1}
                            style={{
                              background: "transparent",
                              border: "1px solid var(--border-color)",
                              borderRadius: "4px",
                              padding: "6px 8px",
                              cursor: sectionOrder.indexOf("trades") === sectionOrder.length - 1 ? "not-allowed" : "pointer",
                              color: "var(--text-primary)",
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                              fontSize: "13px",
                              opacity: sectionOrder.indexOf("trades") === sectionOrder.length - 1 ? 0.3 : 1,
                            }}
                          >
                            <ChevronDown size={14} />
                            <span>Move Down</span>
                          </button>
                          <div style={{ borderTop: "1px solid var(--border-color)", margin: "4px 0" }} />
                          <div style={{ padding: "8px", display: "flex", flexDirection: "column", gap: "8px" }}>
                            <label style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>
                              Trades Per Page:
                            </label>
                            <input
                              type="number"
                              min="5"
                              max="100"
                              step="5"
                              value={tradesPerPage}
                              onChange={(e) => {
                                const value = Math.max(5, Math.min(100, parseInt(e.target.value) || 20));
                                setTradesPerPage(value);
                                localStorage.setItem("tradebutler_trades_per_page", value.toString());
                                setCurrentTradesPage(1); // Reset to first page when changing page size
                              }}
                              onClick={(e) => e.stopPropagation()}
                              style={{
                                padding: "6px 8px",
                                backgroundColor: "var(--bg-tertiary)",
                                border: "1px solid var(--border-color)",
                                borderRadius: "4px",
                                color: "var(--text-primary)",
                                fontSize: "13px",
                                width: "100%",
                              }}
                            />
                          </div>
                        </div>
                      </div>,
                      document.body
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {trades.length === 0 ? (
                    <p style={{ color: "var(--text-secondary)", textAlign: "center", padding: "20px" }}>
                      No trades found for the selected timeframe.
                    </p>
                  ) : (() => {
                    // Calculate pagination
                    const totalPages = Math.ceil(trades.length / tradesPerPage);
                    const startIndex = (currentTradesPage - 1) * tradesPerPage;
                    const endIndex = startIndex + tradesPerPage;
                    const paginatedTrades = trades.slice(startIndex, endIndex);
                    
                return (
                      <>
                        {paginatedTrades.map((trade, idx) => {
                          const actualIndex = startIndex + idx;
                          const isExpanded = expandedTrades.has(actualIndex);
                          return (
                            <div key={`${trade.symbol}-${trade.exit_timestamp}-${actualIndex}`}>
                    <div
                      onClick={() => {
                                  const newExpanded = new Set(expandedTrades);
                        if (isExpanded) {
                                    newExpanded.delete(actualIndex);
                        } else {
                                    newExpanded.add(actualIndex);
                        }
                                  setExpandedTrades(newExpanded);
                      }}
                      style={{
                        padding: "12px",
                        backgroundColor: "var(--bg-tertiary)",
                        borderRadius: "6px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                    >
                      {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      <div style={{ flex: 1, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <p style={{ fontWeight: "600" }}>{trade.symbol}</p>
                        <p
                          style={{
                            fontSize: "14px",
                            fontWeight: "600",
                            color: trade.net_profit_loss >= 0 ? "var(--profit)" : "var(--loss)",
                          }}
                        >
                          {trade.net_profit_loss >= 0 ? "+" : ""}${trade.net_profit_loss.toFixed(2)}
                        </p>
                      </div>
                    </div>
                    {isExpanded && (
                      <div
                        style={{
                          padding: "12px",
                          paddingLeft: "36px",
                          backgroundColor: "var(--bg-primary)",
                          borderBottomLeftRadius: "6px",
                          borderBottomRightRadius: "6px",
                          marginTop: "4px",
                        }}
                      >
                        <div style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ color: "var(--text-secondary)" }}>Entry:</span>
                            <span style={{ color: "var(--text-primary)" }}>
                              {trade.quantity} @ ${trade.entry_price.toFixed(2)}
                            </span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ color: "var(--text-secondary)" }}>Exit:</span>
                            <span style={{ color: "var(--text-primary)" }}>
                              {trade.quantity} @ ${trade.exit_price.toFixed(2)}
                            </span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ color: "var(--text-secondary)" }}>Closed:</span>
                            <span style={{ color: "var(--text-secondary)" }}>
                              {format(new Date(trade.exit_timestamp), "MMM d, HH:mm")}
                            </span>
                          </div>
                        </div>
                        {trade.strategy_name && (
                          <p style={{ fontSize: "11px", color: "var(--accent)", marginTop: "8px" }}>
                            {trade.strategy_name}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                          );
                        })}
                        {/* Pagination Controls */}
                        {totalPages > 1 && (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: "8px",
                              marginTop: "16px",
                              paddingTop: "16px",
                              borderTop: "1px solid var(--border-color)",
                            }}
                          >
                            <button
                              onClick={() => setCurrentTradesPage(prev => Math.max(1, prev - 1))}
                              disabled={currentTradesPage === 1}
                              style={{
                                background: currentTradesPage === 1 ? "var(--bg-tertiary)" : "var(--bg-secondary)",
                                border: "1px solid var(--border-color)",
                                borderRadius: "6px",
                                padding: "6px 12px",
                                color: "var(--text-primary)",
                                cursor: currentTradesPage === 1 ? "not-allowed" : "pointer",
                                fontSize: "13px",
                                opacity: currentTradesPage === 1 ? 0.5 : 1,
                              }}
                            >
                              Previous
                            </button>
                            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                                let pageNum: number;
                                if (totalPages <= 5) {
                                  pageNum = i + 1;
                                } else if (currentTradesPage <= 3) {
                                  pageNum = i + 1;
                                } else if (currentTradesPage >= totalPages - 2) {
                                  pageNum = totalPages - 4 + i;
                                } else {
                                  pageNum = currentTradesPage - 2 + i;
                                }
                                
                                return (
                                  <button
                                    key={pageNum}
                                    onClick={() => setCurrentTradesPage(pageNum)}
                                    style={{
                                      background: currentTradesPage === pageNum ? "var(--accent)" : "var(--bg-secondary)",
                                      border: "1px solid var(--border-color)",
                                      borderRadius: "6px",
                                      padding: "6px 12px",
                                      color: currentTradesPage === pageNum ? "white" : "var(--text-primary)",
                                      cursor: "pointer",
                                      fontSize: "13px",
                                      minWidth: "36px",
                                    }}
                                  >
                                    {pageNum}
                                  </button>
                );
              })}
                </div>
                            <button
                              onClick={() => setCurrentTradesPage(prev => Math.min(totalPages, prev + 1))}
                              disabled={currentTradesPage === totalPages}
                              style={{
                                background: currentTradesPage === totalPages ? "var(--bg-tertiary)" : "var(--bg-secondary)",
                                border: "1px solid var(--border-color)",
                                borderRadius: "6px",
                                padding: "6px 12px",
                                color: "var(--text-primary)",
                                cursor: currentTradesPage === totalPages ? "not-allowed" : "pointer",
                                fontSize: "13px",
                                opacity: currentTradesPage === totalPages ? 0.5 : 1,
                              }}
                            >
                              Next
                            </button>
                            <span style={{ fontSize: "12px", color: "var(--text-secondary)", marginLeft: "8px" }}>
                              Page {currentTradesPage} of {totalPages}
                            </span>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
                  </div>
                )}
              </SortableSection>
            );
          }
          return null;
        })}
      </div>
        </SortableContext>
      </DndContext>

          <MetricsConfigPanel
            isOpen={showMetricsConfig}
            onClose={() => {
              setShowMetricsConfig(false);
              setConfigKey(prev => prev + 1); // Refresh dashboard sections
            }}
            onConfigChange={() => setConfigKey(prev => prev + 1)}
            onAddMetricInstance={addMetricInstance}
          />
        
        {/* Position Group Detail Modal */}
        {showPositionGroupModal && selectedPositionGroup && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(0, 0, 0, 0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 10000,
            }}
            onClick={() => {
              setShowPositionGroupModal(false);
              setSelectedPositionGroup(null);
              setSelectedPositionGroupId(null);
            }}
          >
            <div
              style={{
                backgroundColor: "var(--bg-primary)",
                borderRadius: "12px",
                padding: "24px",
                maxWidth: "800px",
                maxHeight: "80vh",
                overflowY: "auto",
                width: "90%",
                border: "1px solid var(--border-color)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
                <h2 style={{ fontSize: "20px", fontWeight: "bold" }}>
                  {selectedPositionGroup.entry_trade.symbol} - Position Details
                </h2>
                <button
                  onClick={() => {
                    setShowPositionGroupModal(false);
                    setSelectedPositionGroup(null);
                    setSelectedPositionGroupId(null);
                  }}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--text-primary)",
                    cursor: "pointer",
                    fontSize: "24px",
                    padding: "0",
                    width: "32px",
                    height: "32px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  ×
                </button>
              </div>
              
              <div style={{ marginBottom: "20px" }}>
                <p style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "8px" }}>Total P&L:</p>
                <p
                  style={{
                    fontSize: "24px",
                    fontWeight: "bold",
                    color: selectedPositionGroup.total_pnl >= 0 ? "var(--profit)" : "var(--loss)",
                  }}
                >
                  ${selectedPositionGroup.total_pnl.toFixed(2)}
                </p>
              </div>
              
              <div style={{ marginBottom: "20px" }}>
                <h3 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "12px" }}>Entry Trade</h3>
                <div
                  style={{
                    backgroundColor: "var(--bg-secondary)",
                    borderRadius: "8px",
                    padding: "12px",
                    marginBottom: "12px",
                  }}
                >
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "14px" }}>
                    <div>
                      <span style={{ color: "var(--text-secondary)" }}>Side: </span>
                      <span style={{ color: selectedPositionGroup.entry_trade.side === "BUY" ? "var(--profit)" : "var(--loss)" }}>
                        {selectedPositionGroup.entry_trade.side}
                      </span>
                    </div>
                    <div>
                      <span style={{ color: "var(--text-secondary)" }}>Quantity: </span>
                      <span>{selectedPositionGroup.entry_trade.quantity}</span>
                    </div>
                    <div>
                      <span style={{ color: "var(--text-secondary)" }}>Price: </span>
                      <span>${selectedPositionGroup.entry_trade.price.toFixed(2)}</span>
                    </div>
                    <div>
                      <span style={{ color: "var(--text-secondary)" }}>Date: </span>
                      <span>{format(new Date(selectedPositionGroup.entry_trade.timestamp), "MMM dd, yyyy HH:mm")}</span>
                    </div>
                  </div>
                </div>
              </div>
              
              <div>
                <h3 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "12px" }}>
                  Position Trades ({selectedPositionGroup.position_trades.length})
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {selectedPositionGroup.position_trades.map((trade: any, idx: number) => (
                    <div
                      key={idx}
                      style={{
                        backgroundColor: "var(--bg-secondary)",
                        borderRadius: "8px",
                        padding: "12px",
                      }}
                    >
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "14px" }}>
                        <div>
                          <span style={{ color: "var(--text-secondary)" }}>Side: </span>
                          <span style={{ color: trade.side === "BUY" ? "var(--profit)" : "var(--loss)" }}>
                            {trade.side}
                          </span>
                        </div>
                        <div>
                          <span style={{ color: "var(--text-secondary)" }}>Quantity: </span>
                          <span>{trade.quantity}</span>
                        </div>
                        <div>
                          <span style={{ color: "var(--text-secondary)" }}>Price: </span>
                          <span>${trade.price.toFixed(2)}</span>
                        </div>
                        <div>
                          <span style={{ color: "var(--text-secondary)" }}>Date: </span>
                          <span>{format(new Date(trade.timestamp), "MMM dd, yyyy HH:mm")}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
    </div>
  );
}
