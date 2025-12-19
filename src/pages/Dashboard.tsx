import { useEffect, useState, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/tauri";
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

interface StrategyPerformance {
  strategy_id: number | null;
  strategy_name: string;
  trade_count: number;
  total_volume: number;
  estimated_pnl: number;
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
    default:
      return value.toFixed(2);
  }
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

interface DashboardSections {
  showTopSymbols: boolean;
  showStrategyPerformance: boolean;
  showRecentTrades: boolean;
}

const defaultDashboardSections: DashboardSections = {
  showTopSymbols: true,
  showStrategyPerformance: true,
  showRecentTrades: true,
};

type SectionId = "topSymbols" | "strategyPerformance" | "recentTrades";

const defaultSectionOrder: SectionId[] = ["topSymbols", "strategyPerformance", "recentTrades"];

export default function Dashboard() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [topSymbols, setTopSymbols] = useState<TopSymbol[]>([]);
  const [strategyPerformance, setStrategyPerformance] = useState<StrategyPerformance[]>([]);
  const [recentTrades, setRecentTrades] = useState<RecentTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [showMetricsConfig, setShowMetricsConfig] = useState(false);
  const [configKey, setConfigKey] = useState(0); // Force re-render when config changes
  const metricsConfigHook = useMetricsConfig();
  const [expandedRecentTrades, setExpandedRecentTrades] = useState<Set<number>>(new Set());
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
        // Validate that all sections are present
        const validOrder = defaultSectionOrder.filter(id => parsed.includes(id));
        const missing = defaultSectionOrder.filter(id => !parsed.includes(id));
        return [...validOrder, ...missing];
      } catch {
        return defaultSectionOrder;
      }
    }
    return defaultSectionOrder;
  });
  const [draggedSection, setDraggedSection] = useState<SectionId | null>(null);
  const [dragOverSection, setDragOverSection] = useState<SectionId | null>(null);
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
  const [draggedMetric, setDraggedMetric] = useState<string | null>(null);
  const [dragOverMetric, setDragOverMetric] = useState<string | null>(null);
  const draggedMetricRef = useRef<string | null>(null);
  const [openMetricSettings, setOpenMetricSettings] = useState<string | null>(null);
  const [openSectionSettings, setOpenSectionSettings] = useState<SectionId | null>(null);
  const [metricMenuPosition, setMetricMenuPosition] = useState({ top: 0, right: 0 });
  const [sectionMenuPosition, setSectionMenuPosition] = useState<Record<SectionId, { top: number; right: number }>>({
    topSymbols: { top: 0, right: 0 },
    strategyPerformance: { top: 0, right: 0 },
    recentTrades: { top: 0, right: 0 },
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
  
  useEffect(() => {
    // Re-read from localStorage when configKey changes (includes color range changes)
    const saved = localStorage.getItem("tradebutler_metrics_config");
    if (saved) {
      try {
        const allMetrics = JSON.parse(saved);
        const enabled = allMetrics.filter((m: any) => m.enabled);
        setEnabledMetrics(enabled);
        
        // Initialize or update metric card order
        const currentOrder = localStorage.getItem(METRIC_CARDS_ORDER_KEY);
        const enabledIds = enabled.map((m: any) => m.id);
        
        if (!currentOrder || currentOrder === "[]") {
          // Initialize with current enabled metrics
          setMetricCardOrder(enabledIds);
          localStorage.setItem(METRIC_CARDS_ORDER_KEY, JSON.stringify(enabledIds));
        } else {
          // Update order to include any new metrics and remove disabled ones
          const savedOrder: string[] = JSON.parse(currentOrder);
          const newOrder = [...savedOrder];
          
          // Add any missing metric IDs to the end
          enabledIds.forEach((id: string) => {
            if (!newOrder.includes(id)) {
              newOrder.push(id);
            }
          });
          
          // Remove any IDs that are no longer enabled
          const filteredOrder = newOrder.filter((id: string) => enabledIds.includes(id));
          
          if (JSON.stringify(filteredOrder) !== JSON.stringify(metricCardOrder)) {
            setMetricCardOrder(filteredOrder);
            localStorage.setItem(METRIC_CARDS_ORDER_KEY, JSON.stringify(filteredOrder));
          }
        }
      } catch {
        const enabled = metricsConfigHook.getEnabledMetrics();
        setEnabledMetrics(enabled);
        const order = enabled.map(m => m.id);
        setMetricCardOrder(order);
        localStorage.setItem(METRIC_CARDS_ORDER_KEY, JSON.stringify(order));
      }
    } else {
      const enabled = metricsConfigHook.getEnabledMetrics();
      setEnabledMetrics(enabled);
      const order = enabled.map(m => m.id);
      setMetricCardOrder(order);
      localStorage.setItem(METRIC_CARDS_ORDER_KEY, JSON.stringify(order));
    }
  }, [configKey, metricsConfigHook]);

  // Sync metric card order when enabled metrics change
  useEffect(() => {
    const enabledIds = enabledMetrics.map(m => m.id);
    if (enabledIds.length === 0) return;
    
    setMetricCardOrder(prevOrder => {
      const newOrder = [...prevOrder];
      
      // Add any missing metric IDs to the end
      enabledIds.forEach(id => {
        if (!newOrder.includes(id)) {
          newOrder.push(id);
        }
      });
      
      // Remove any IDs that are no longer enabled
      const filteredOrder = newOrder.filter(id => enabledIds.includes(id));
      
      // Only update if order actually changed
      if (JSON.stringify(filteredOrder) !== JSON.stringify(prevOrder)) {
        localStorage.setItem(METRIC_CARDS_ORDER_KEY, JSON.stringify(filteredOrder));
        return filteredOrder;
      }
      return prevOrder;
    });
  }, [enabledMetrics]); // Only run when enabledMetrics changes

  // Sort metrics by saved order using useMemo
  const sortedMetrics = useMemo(() => {
    return [...enabledMetrics].sort((a, b) => {
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
  }, [enabledMetrics, metricCardOrder]);
  
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
  }, [timeframe, customStartDate, customEndDate]);
  
  useEffect(() => {
    localStorage.setItem("tradebutler_dashboard_timeframe", timeframe);
  }, [timeframe]);
  
  useEffect(() => {
    if (customStartDate) {
      localStorage.setItem("tradebutler_dashboard_custom_start", customStartDate);
    }
    if (customEndDate) {
      localStorage.setItem("tradebutler_dashboard_custom_end", customEndDate);
    }
  }, [customStartDate, customEndDate]);

  // Re-read dashboard sections from localStorage when config changes
  useEffect(() => {
    const saved = localStorage.getItem(DASHBOARD_SECTIONS_KEY);
    if (saved) {
      try {
        setDashboardSections({ ...defaultDashboardSections, ...JSON.parse(saved) });
      } catch {
        // Keep current state
      }
    }
  }, [configKey]);

  const loadDashboardData = async () => {
    try {
      const pairingMethod = localStorage.getItem("tradebutler_pairing_method") || "FIFO";
      const dateRange = getTimeframeDates(timeframe, customStartDate, customEndDate);
      const startDate = dateRange.start ? dateRange.start.toISOString() : null;
      const endDate = dateRange.end ? dateRange.end.toISOString() : null;
      
      const [metricsData, pnlData, strategiesData, tradesData] = await Promise.all([
        invoke<Metrics>("get_metrics", { pairingMethod, startDate, endDate }),
        invoke<SymbolPnL[]>("get_symbol_pnl", { pairingMethod, startDate, endDate }),
        invoke<StrategyPerformance[]>("get_strategy_performance", { startDate, endDate }),
        invoke<RecentTrade[]>("get_recent_trades", { limit: 5, pairingMethod, startDate, endDate }),
      ]);
      setMetrics(metricsData);
      
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
    } catch (error) {
      console.error("Error loading dashboard data:", error);
    } finally {
      setLoading(false);
    }
  };

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
    strategy_win_rate: metrics?.strategy_win_rate || 0,
    strategy_winning_trades: metrics?.strategy_winning_trades || 0,
    strategy_losing_trades: metrics?.strategy_losing_trades || 0,
    strategy_profit_loss: metrics?.strategy_profit_loss || 0,
    strategy_consecutive_wins: metrics?.strategy_consecutive_wins || 0,
    strategy_consecutive_losses: metrics?.strategy_consecutive_losses || 0,
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
                setCustomStartDate(start);
                setCustomEndDate(end);
              }}
            />
          </div>

      {/* Metrics Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: "20px",
          marginBottom: "30px",
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
      >
        {sortedMetrics.map((metric) => {
          const value = metricValues[metric.id] || 0;
          const Icon = metricIcons[metric.id] || Activity;
          const color = getMetricColor(metric.id, value);

          return (
            <div
              key={metric.id}
              draggable={true}
              onDragStart={(e) => {
                // Prevent drag if starting from a button
                const target = e.target as HTMLElement;
                if (target.tagName === 'BUTTON' || target.closest('button')) {
                  e.preventDefault();
                  return false;
                }
                
                draggedMetricRef.current = metric.id;
                setDraggedMetric(metric.id);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", metric.id);
                e.dataTransfer.setData("application/json", JSON.stringify({ type: "metric", id: metric.id }));
              }}
              onDragEnter={(e) => {
                e.preventDefault();
                const dragged = draggedMetricRef.current || draggedMetric;
                if (dragged && dragged !== metric.id) {
                  setDragOverMetric(metric.id);
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                const dragged = draggedMetricRef.current || draggedMetric;
                if (dragged && dragged !== metric.id) {
                  setDragOverMetric(metric.id);
                }
              }}
              onDragLeave={(e) => {
                // Check if we're actually leaving the element
                const rect = e.currentTarget.getBoundingClientRect();
                const x = e.clientX;
                const y = e.clientY;
                if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
                  setDragOverMetric(null);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                // Try multiple ways to get the dragged metric ID
                let dragged: string | null = null;
                try {
                  const jsonData = e.dataTransfer.getData("application/json");
                  if (jsonData) {
                    const parsed = JSON.parse(jsonData);
                    if (parsed.type === "metric" && parsed.id) {
                      dragged = parsed.id;
                    }
                  }
                } catch {}
                
                if (!dragged) {
                  dragged = e.dataTransfer.getData("text/plain") || draggedMetricRef.current || draggedMetric;
                }
                
                if (!dragged || dragged === metric.id) {
                  draggedMetricRef.current = null;
                  setDraggedMetric(null);
                  setDragOverMetric(null);
                  return;
                }
                
                setMetricCardOrder(prevOrder => {
                  const currentIds = enabledMetrics.map(m => m.id);
                  let newOrder = [...prevOrder];
                  
                  // Ensure all enabled metrics are in the order
                  currentIds.forEach(id => {
                    if (!newOrder.includes(id)) {
                      newOrder.push(id);
                    }
                  });
                  
                  // Remove any IDs that are no longer enabled
                  newOrder = newOrder.filter(id => currentIds.includes(id));
                  
                  // Reorder: move draggedMetric to the position of metric.id
                  const draggedIndex = newOrder.indexOf(dragged);
                  const targetIndex = newOrder.indexOf(metric.id);
                  
                  if (draggedIndex !== -1 && targetIndex !== -1 && draggedIndex !== targetIndex) {
                    // Remove dragged item from its current position
                    newOrder.splice(draggedIndex, 1);
                    // Calculate new target index (may have shifted after removal)
                    const newTargetIndex = draggedIndex < targetIndex ? targetIndex - 1 : targetIndex;
                    // Insert it at the target position
                    newOrder.splice(newTargetIndex, 0, dragged);
                    
                    // Save to localStorage
                    localStorage.setItem(METRIC_CARDS_ORDER_KEY, JSON.stringify(newOrder));
                    return newOrder;
                  }
                  return prevOrder;
                });
                draggedMetricRef.current = null;
                setDraggedMetric(null);
                setDragOverMetric(null);
              }}
              onDragEnd={() => {
                draggedMetricRef.current = null;
                setDraggedMetric(null);
                setDragOverMetric(null);
              }}
              style={{
                backgroundColor: "var(--bg-secondary)",
                border: "1px solid var(--border-color)",
                borderRadius: "8px",
                padding: "20px",
                display: "flex",
                alignItems: "center",
                gap: "16px",
                cursor: draggedMetric === metric.id ? "grabbing" : "grab",
                opacity: draggedMetric === metric.id ? 0.5 : 1,
                borderColor: dragOverMetric === metric.id ? "var(--accent)" : "var(--border-color)",
                borderWidth: dragOverMetric === metric.id ? "2px" : "1px",
                userSelect: "none",
                WebkitUserSelect: "none",
                width: "100%",
                height: "100px",
                transition: "border-color 0.2s, opacity 0.2s, transform 0.2s",
                transform: draggedMetric === metric.id ? "scale(0.95)" : dragOverMetric === metric.id ? "scale(1.02)" : "scale(1)",
              }}
            >
              <GripVertical 
                size={16} 
                color="var(--text-secondary)" 
                style={{ cursor: "grab", flexShrink: 0, pointerEvents: "none" }} 
              />
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
              <div style={{ flex: 1, pointerEvents: "none" }}>
                <p
                  style={{
                    fontSize: "14px",
                    color: "var(--text-secondary)",
                    marginBottom: "4px",
                  }}
                >
                  {metric.label}
                </p>
                <p
                  style={{
                    fontSize: "24px",
                    fontWeight: "bold",
                    color: color,
                  }}
                >
                  {formatMetricValue(metric.id, value, metrics)}
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
                    </div>
                  </div>,
                  document.body
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Dashboard Stats Grid */}
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
              <div
                key="topSymbols"
                draggable
                onDragStart={(e) => {
                  setDraggedSection("topSymbols");
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (draggedSection !== "topSymbols") {
                    setDragOverSection("topSymbols");
                  }
                }}
                onDragLeave={() => {
                  setDragOverSection(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (draggedSection && draggedSection !== "topSymbols") {
                    const newOrder = [...sectionOrder];
                    const draggedIndex = newOrder.indexOf(draggedSection);
                    const targetIndex = newOrder.indexOf("topSymbols");
                    newOrder.splice(draggedIndex, 1);
                    newOrder.splice(targetIndex, 0, draggedSection);
                    setSectionOrder(newOrder);
                    localStorage.setItem(DASHBOARD_SECTION_ORDER_KEY, JSON.stringify(newOrder));
                  }
                  setDraggedSection(null);
                  setDragOverSection(null);
                }}
                onDragEnd={() => {
                  setDraggedSection(null);
                  setDragOverSection(null);
                }}
                style={{
                  backgroundColor: "var(--bg-secondary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "8px",
                  padding: "20px",
                  cursor: "grab",
                  opacity: draggedSection === "topSymbols" ? 0.5 : 1,
                  borderColor: dragOverSection === "topSymbols" ? "var(--accent)" : "var(--border-color)",
                  borderWidth: dragOverSection === "topSymbols" ? "2px" : "1px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <GripVertical size={16} color="var(--text-secondary)" style={{ cursor: "grab" }} />
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
            );
          }

          // Strategy Performance
          if (sectionId === "strategyPerformance" && dashboardSections.showStrategyPerformance && strategyPerformance.length > 0) {
            return (
              <div
                key="strategyPerformance"
                draggable
                onDragStart={(e) => {
                  setDraggedSection("strategyPerformance");
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (draggedSection !== "strategyPerformance") {
                    setDragOverSection("strategyPerformance");
                  }
                }}
                onDragLeave={() => {
                  setDragOverSection(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (draggedSection && draggedSection !== "strategyPerformance") {
                    const newOrder = [...sectionOrder];
                    const draggedIndex = newOrder.indexOf(draggedSection);
                    const targetIndex = newOrder.indexOf("strategyPerformance");
                    newOrder.splice(draggedIndex, 1);
                    newOrder.splice(targetIndex, 0, draggedSection);
                    setSectionOrder(newOrder);
                    localStorage.setItem(DASHBOARD_SECTION_ORDER_KEY, JSON.stringify(newOrder));
                  }
                  setDraggedSection(null);
                  setDragOverSection(null);
                }}
                onDragEnd={() => {
                  setDraggedSection(null);
                  setDragOverSection(null);
                }}
                style={{
                  backgroundColor: "var(--bg-secondary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "8px",
                  padding: "20px",
                  cursor: "grab",
                  opacity: draggedSection === "strategyPerformance" ? 0.5 : 1,
                  borderColor: dragOverSection === "strategyPerformance" ? "var(--accent)" : "var(--border-color)",
                  borderWidth: dragOverSection === "strategyPerformance" ? "2px" : "1px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <GripVertical size={16} color="var(--text-secondary)" style={{ cursor: "grab" }} />
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
                        </div>
                      </div>,
                      document.body
                    )}
                  </div>
                </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {strategyPerformance.map((strategy) => (
                <div
                  key={strategy.strategy_id || "unassigned"}
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
                    <p style={{ fontWeight: "600", marginBottom: "4px" }}>{strategy.strategy_name}</p>
                    <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                      {strategy.trade_count} trades
                    </p>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <p
                      style={{
                        fontWeight: "600",
                        color: strategy.estimated_pnl >= 0 ? "var(--profit)" : "var(--loss)",
                      }}
                    >
                      ${strategy.estimated_pnl.toFixed(2)}
                    </p>
                    <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                      ${(strategy.total_volume / 1000).toFixed(1)}k vol
                    </p>
                  </div>
                </div>
              ))}
              </div>
            </div>
            );
          }

          // Recent Trades
          if (sectionId === "recentTrades" && dashboardSections.showRecentTrades && recentTrades.length > 0) {
            return (
              <div
                key="recentTrades"
                draggable
                onDragStart={(e) => {
                  setDraggedSection("recentTrades");
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (draggedSection !== "recentTrades") {
                    setDragOverSection("recentTrades");
                  }
                }}
                onDragLeave={() => {
                  setDragOverSection(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (draggedSection && draggedSection !== "recentTrades") {
                    const newOrder = [...sectionOrder];
                    const draggedIndex = newOrder.indexOf(draggedSection);
                    const targetIndex = newOrder.indexOf("recentTrades");
                    newOrder.splice(draggedIndex, 1);
                    newOrder.splice(targetIndex, 0, draggedSection);
                    setSectionOrder(newOrder);
                    localStorage.setItem(DASHBOARD_SECTION_ORDER_KEY, JSON.stringify(newOrder));
                  }
                  setDraggedSection(null);
                  setDragOverSection(null);
                }}
                onDragEnd={() => {
                  setDraggedSection(null);
                  setDragOverSection(null);
                }}
                style={{
                  backgroundColor: "var(--bg-secondary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "8px",
                  padding: "20px",
                  cursor: "grab",
                  opacity: draggedSection === "recentTrades" ? 0.5 : 1,
                  borderColor: dragOverSection === "recentTrades" ? "var(--accent)" : "var(--border-color)",
                  borderWidth: dragOverSection === "recentTrades" ? "2px" : "1px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <GripVertical size={16} color="var(--text-secondary)" style={{ cursor: "grab" }} />
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
            );
          }
          return null;
        })}
      </div>

          <MetricsConfigPanel
            isOpen={showMetricsConfig}
            onClose={() => {
              setShowMetricsConfig(false);
              setConfigKey(prev => prev + 1); // Refresh dashboard sections
            }}
            onConfigChange={() => setConfigKey(prev => prev + 1)}
          />
    </div>
  );
}
