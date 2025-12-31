import { useEffect, useState, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { TimeframeSelector, Timeframe, getTimeframeDates } from "../components/TimeframeSelector";
import { Settings } from "lucide-react";
import { createPortal } from "react-dom";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface WeekdayPerformance {
  weekday: number;
  weekday_name: string;
  total_pnl: number;
  trade_count: number;
  win_rate: number;
  average_win: number;
  average_loss: number;
  payoff_ratio: number;
  profit_factor: number;
  gross_profit: number;
  gross_loss: number;
}

interface DayOfMonthPerformance {
  day: number;
  total_pnl: number;
  trade_count: number;
  win_rate: number;
  average_win: number;
  average_loss: number;
  payoff_ratio: number;
  profit_factor: number;
  gross_profit: number;
  gross_loss: number;
}

interface TimeOfDayPerformance {
  hour: number;
  hour_label: string;
  total_pnl: number;
  trade_count: number;
  win_rate: number;
  average_win: number;
  average_loss: number;
  payoff_ratio: number;
  profit_factor: number;
  gross_profit: number;
  gross_loss: number;
}

interface SymbolPerformance {
  symbol: string;
  trade_count: number;
  win_rate: number;
  total_pnl: number;
  average_pnl: number;
  average_win: number;
  average_loss: number;
  payoff_ratio: number;
  profit_factor: number;
  gross_profit: number;
  gross_loss: number;
}

interface StrategyPerformanceDetail {
  strategy_id: number | null;
  strategy_name: string;
  trade_count: number;
  win_rate: number;
  total_pnl: number;
  average_pnl: number;
  average_win: number;
  average_loss: number;
  payoff_ratio: number;
  profit_factor: number;
  gross_profit: number;
  gross_loss: number;
}

interface EvaluationMetrics {
  weekday_performance: WeekdayPerformance[];
  day_of_month_performance: DayOfMonthPerformance[];
  time_of_day_performance: TimeOfDayPerformance[];
  symbol_performance: SymbolPerformance[];
  strategy_performance: StrategyPerformanceDetail[];
}

interface HistogramBin {
  bin_start: number;
  bin_end: number;
  count: number;
  total_pnl: number;
}

interface ConcentrationStats {
  total_trades: number;
  profitable_trades_count: number;
  losing_trades_count: number;
  top_k: number;
  profit_share_top: number;
  loss_share_top: number;
  mean_return: number;
  median_return: number;
  stability_score: number;
  insights: string[];
}

interface DistributionConcentrationData {
  histogram: HistogramBin[];
  concentration: ConcentrationStats;
}

interface StreakStats {
  k: number;
  sample_size: number;
  win_rate_after_k_losses: number;
  avg_pnl_after_k_losses: number;
}

interface TiltStats {
  baseline_win_rate: number;
  win_rate_after_loss: number;
  win_rate_after_win: number;
  win_rate_after_2_losses: number;
  avg_loss_normally: number;
  avg_loss_after_loss: number;
  prob_loss_after_loss: number;
  tilt_score: number;
  recommended_streak: number | null;
  streak_stats: StreakStats[];
  coaching_lines: string[];
  tilt_category: string;
}

export default function Evaluation() {
  const [metrics, setMetrics] = useState<EvaluationMetrics | null>(null);
  const [concentrationData, setConcentrationData] = useState<DistributionConcentrationData | null>(null);
  const [tiltData, setTiltData] = useState<TiltStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeframe, setTimeframe] = useState<Timeframe>(() => {
    const saved = localStorage.getItem("tradebutler_evaluation_timeframe");
    return (saved as Timeframe) || "all";
  });
  const [customStartDate, setCustomStartDate] = useState<string>(() => {
    return localStorage.getItem("tradebutler_evaluation_custom_start") || "";
  });
  const [customEndDate, setCustomEndDate] = useState<string>(() => {
    return localStorage.getItem("tradebutler_evaluation_custom_end") || "";
  });
  const [concentrationPercent, setConcentrationPercent] = useState<number>(() => {
    const saved = localStorage.getItem("tradebutler_concentration_percent");
    return saved ? parseFloat(saved) : 10;
  });
  const [showConcentrationSettings, setShowConcentrationSettings] = useState(false);
  const concentrationSettingsButtonRef = useRef<HTMLButtonElement>(null);
  const concentrationSettingsRef = useRef<HTMLDivElement>(null);

  const loadEvaluationData = async () => {
    try {
      setLoading(true);
      const pairingMethod = localStorage.getItem("tradebutler_pairing_method") || "FIFO";
      const { start, end } = getTimeframeDates(timeframe, customStartDate, customEndDate);
      
      const [data, concentration, tilt] = await Promise.all([
        invoke<EvaluationMetrics>("get_evaluation_metrics", {
          pairingMethod,
          startDate: start ? start.toISOString() : null,
          endDate: end ? end.toISOString() : null,
        }),
        invoke<DistributionConcentrationData>("get_distribution_concentration", {
          pairingMethod,
          startDate: start ? start.toISOString() : null,
          endDate: end ? end.toISOString() : null,
          concentrationPercent: concentrationPercent,
        }),
        invoke<TiltStats>("get_tilt_metric", {
          pairingMethod,
          startDate: start ? start.toISOString() : null,
          endDate: end ? end.toISOString() : null,
        }),
      ]);
      
      setMetrics(data);
      setConcentrationData(concentration);
      setTiltData(tilt);
    } catch (error) {
      console.error("Error loading evaluation data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEvaluationData();
  }, [timeframe, customStartDate, customEndDate, concentrationPercent]);

  // Click outside handler for concentration settings
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        showConcentrationSettings &&
        concentrationSettingsRef.current &&
        !concentrationSettingsRef.current.contains(target) &&
        concentrationSettingsButtonRef.current &&
        !concentrationSettingsButtonRef.current.contains(target)
      ) {
        // Check if the click is on an input field inside the settings panel
        const isInput = (target as HTMLElement).tagName === "INPUT" || 
                       (target as HTMLElement).tagName === "LABEL" ||
                       concentrationSettingsRef.current.querySelector("input")?.contains(target);
        
        if (!isInput) {
          setShowConcentrationSettings(false);
        }
      }
    };

    if (showConcentrationSettings) {
      // Use a slight delay to allow input focus events to complete
      document.addEventListener("mousedown", handleClickOutside, true);
      return () => document.removeEventListener("mousedown", handleClickOutside, true);
    }
  }, [showConcentrationSettings]);

  // Generate insights
  const insights = useMemo(() => {
    if (!metrics) return [];
    
    const insightsList: string[] = [];
    const minTrades = 5;
    
    // Weekday insights
    const weekdayWithTrades = metrics.weekday_performance.filter(w => w.trade_count >= minTrades);
    if (weekdayWithTrades.length > 0) {
      const bestWeekday = weekdayWithTrades.reduce((best, current) => 
        current.total_pnl > best.total_pnl ? current : best
      );
      if (bestWeekday.total_pnl > 0) {
        insightsList.push(
          `You perform best on ${bestWeekday.weekday_name}s with a total P&L of $${bestWeekday.total_pnl.toFixed(2)} and a win rate of ${(bestWeekday.win_rate * 100).toFixed(1)}%.`
        );
      }
      
      const worstWeekday = weekdayWithTrades.reduce((worst, current) => 
        current.total_pnl < worst.total_pnl ? current : worst
      );
      if (worstWeekday.total_pnl < 0 && worstWeekday.profit_factor < 1.0) {
        insightsList.push(
          `You consistently lose on ${worstWeekday.weekday_name}s with a total P&L of $${worstWeekday.total_pnl.toFixed(2)} and a profit factor of ${worstWeekday.profit_factor.toFixed(2)}.`
        );
      }
    }
    
    // Symbol insights
    const symbolWithTrades = metrics.symbol_performance.filter(s => s.trade_count >= minTrades);
    if (symbolWithTrades.length > 0) {
      const bestSymbol = symbolWithTrades.reduce((best, current) => 
        current.total_pnl > best.total_pnl ? current : best
      );
      if (bestSymbol.profit_factor > 1.5 && bestSymbol.win_rate > 0.55) {
        insightsList.push(
          `Your strongest symbol is ${bestSymbol.symbol} with a profit factor of ${bestSymbol.profit_factor.toFixed(2)}, win rate of ${(bestSymbol.win_rate * 100).toFixed(1)}%, and total P&L of $${bestSymbol.total_pnl.toFixed(2)}.`
        );
      }
      
      const worstSymbol = symbolWithTrades.reduce((worst, current) => 
        current.total_pnl < worst.total_pnl ? current : worst
      );
      if (worstSymbol.total_pnl < 0 && worstSymbol.profit_factor < 1.0) {
        insightsList.push(
          `Your weakest symbol is ${worstSymbol.symbol} with a total P&L of $${worstSymbol.total_pnl.toFixed(2)} and a profit factor of ${worstSymbol.profit_factor.toFixed(2)}.`
        );
      }
    }
    
    // Strategy insights
    const strategyWithTrades = metrics.strategy_performance.filter(s => s.trade_count >= minTrades && s.strategy_name !== "Unassigned");
    if (strategyWithTrades.length > 0) {
      const bestStrategy = strategyWithTrades.reduce((best, current) => 
        current.total_pnl > best.total_pnl ? current : best
      );
      if (bestStrategy.profit_factor > 1.5 && bestStrategy.win_rate > 0.55) {
        insightsList.push(
          `Your strongest strategy is "${bestStrategy.strategy_name}" with a profit factor of ${bestStrategy.profit_factor.toFixed(2)}, win rate of ${(bestStrategy.win_rate * 100).toFixed(1)}%, and total P&L of $${bestStrategy.total_pnl.toFixed(2)}.`
        );
      }
    }
    
    // Time of day insights
    const timeWithTrades = metrics.time_of_day_performance.filter(t => t.trade_count >= minTrades);
    if (timeWithTrades.length > 0) {
      const worstTime = timeWithTrades.reduce((worst, current) => 
        current.total_pnl < worst.total_pnl ? current : worst
      );
      if (worstTime.total_pnl < 0) {
        insightsList.push(
          `Your weakest time window is ${worstTime.hour_label} with a total P&L of $${worstTime.total_pnl.toFixed(2)}.`
        );
      }
      
      const bestTime = timeWithTrades.reduce((best, current) => 
        current.total_pnl > best.total_pnl ? current : best
      );
      if (bestTime.total_pnl > 0 && bestTime.trade_count >= minTrades) {
        insightsList.push(
          `Your strongest time window is ${bestTime.hour_label} with a total P&L of $${bestTime.total_pnl.toFixed(2)} and a win rate of ${(bestTime.win_rate * 100).toFixed(1)}%.`
        );
      }
    }
    
    return insightsList;
  }, [metrics]);

  // Helper function to get color for heatmap
  // Uses absolute values: positive = green, negative = red
  const getHeatmapColor = (value: number, max: number, min: number): string => {
    if (value === 0) return "var(--bg-tertiary)";
    
    // Use absolute value to determine color (positive = green, negative = red)
    if (value > 0) {
      // Positive - green scale (intensity based on how close to max)
      const intensity = max > 0 ? Math.min(value / max, 1) : 0.5;
      return `rgba(34, 197, 94, ${0.1 + intensity * 0.2})`; // Range: 0.1 to 0.3
    } else {
      // Negative - red scale (intensity based on how close to min)
      const intensity = min < 0 ? Math.min(Math.abs(value) / Math.abs(min), 1) : 0.5;
      return `rgba(239, 68, 68, ${0.1 + intensity * 0.2})`; // Range: 0.1 to 0.3
    }
  };

  // Helper function to get color for win rate heatmap
  // Win rates: >= 0.5 (50%) = green, < 0.5 = red
  const getWinRateHeatmapColor = (winRate: number, max: number, min: number): string => {
    if (winRate === 0) return "var(--bg-tertiary)";
    
    // Use 0.5 (50%) as the threshold
    if (winRate >= 0.5) {
      // >= 50% - green scale (intensity based on how close to max)
      const intensity = max >= 0.5 ? Math.min((winRate - 0.5) / (max - 0.5), 1) : 0.5;
      return `rgba(34, 197, 94, ${0.1 + intensity * 0.2})`; // Range: 0.1 to 0.3
    } else {
      // < 50% - red scale (intensity based on how close to 0)
      const intensity = min < 0.5 ? Math.min((0.5 - winRate) / (0.5 - min), 1) : 0.5;
      return `rgba(239, 68, 68, ${0.1 + intensity * 0.2})`; // Range: 0.1 to 0.3
    }
  };

  if (loading) {
    return (
      <div style={{ padding: "40px", textAlign: "center" }}>
        <p>Loading evaluation metrics...</p>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div style={{ padding: "40px", textAlign: "center" }}>
        <p>No evaluation data available. Import trades to see analysis.</p>
      </div>
    );
  }

  // Calculate min/max for heatmaps
  const weekdayPnlValues = metrics.weekday_performance.map(w => w.total_pnl);
  const weekdayMax = Math.max(...weekdayPnlValues, 1);
  const weekdayMin = Math.min(...weekdayPnlValues, -1);

  const dayOfMonthPnlValues = metrics.day_of_month_performance.map(d => d.total_pnl);
  const dayOfMonthMax = Math.max(...dayOfMonthPnlValues, 1);
  const dayOfMonthMin = Math.min(...dayOfMonthPnlValues, -1);

  const timeOfDayPnlValues = metrics.time_of_day_performance.map(t => t.total_pnl);
  const timeOfDayMax = Math.max(...timeOfDayPnlValues, 1);
  const timeOfDayMin = Math.min(...timeOfDayPnlValues, -1);

  return (
    <div style={{ padding: "30px", overflowY: "auto", height: "100%" }}>
      <h1 style={{ fontSize: "32px", fontWeight: "bold", marginBottom: "20px" }}>Evaluation</h1>
      
      <div style={{ marginBottom: "30px" }}>
        <TimeframeSelector
          value={timeframe}
          onChange={(value) => {
            setTimeframe(value);
            localStorage.setItem("tradebutler_evaluation_timeframe", value);
          }}
          customStartDate={customStartDate}
          customEndDate={customEndDate}
          onCustomDatesChange={(start, end) => {
            setCustomStartDate(start || "");
            setCustomEndDate(end || "");
            if (start) {
              localStorage.setItem("tradebutler_evaluation_custom_start", start);
            } else {
              localStorage.removeItem("tradebutler_evaluation_custom_start");
            }
            if (end) {
              localStorage.setItem("tradebutler_evaluation_custom_end", end);
            } else {
              localStorage.removeItem("tradebutler_evaluation_custom_end");
            }
          }}
        />
      </div>

      {/* Key Insights */}
      {insights.length > 0 && (
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
            Key Insights
          </h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "12px" }}>
            {insights.map((insight, idx) => (
              <li
                key={idx}
                style={{
                  padding: "12px",
                  backgroundColor: "var(--bg-tertiary)",
                  borderRadius: "6px",
                  fontSize: "14px",
                  lineHeight: "1.6",
                }}
              >
                {insight}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Weekday Performance Heatmap */}
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
          Weekday Performance
        </h2>
        
        {/* P&L Heatmap */}
        <div style={{ marginBottom: "20px" }}>
          <h3 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "12px", color: "var(--text-secondary)" }}>
            Total Net P&L by Weekday
          </h3>
          <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
            {metrics.weekday_performance.map((day) => {
              const color = getHeatmapColor(day.total_pnl, weekdayMax, weekdayMin);
              const isBest = day.total_pnl === weekdayMax && day.trade_count > 0;
              const isWorst = day.total_pnl === weekdayMin && day.trade_count > 0;
              
              return (
                <div
                  key={day.weekday}
                  style={{
                    flex: 1,
                    padding: "16px",
                    backgroundColor: color,
                    borderRadius: "6px",
                    textAlign: "center",
                    border: isBest ? "2px solid var(--profit)" : isWorst ? "2px solid var(--loss)" : "1px solid var(--border-color)",
                    position: "relative",
                  }}
                >
                  <div style={{ fontSize: "12px", fontWeight: "600", marginBottom: "8px" }}>
                    {day.weekday_name.substring(0, 3)}
                  </div>
                  <div
                    style={{
                      fontSize: "18px",
                      fontWeight: "bold",
                      color: day.total_pnl === 0 ? "var(--text-primary)" : day.total_pnl > 0 ? "var(--profit)" : "var(--loss)",
                      marginBottom: "4px",
                    }}
                  >
                    ${day.total_pnl.toFixed(2)}
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                    {day.trade_count} trades
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        
        {/* Win Rate Heatmap */}
        <div style={{ marginBottom: "16px" }}>
          <h3 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "12px", color: "var(--text-secondary)" }}>
            Win Rate by Weekday
          </h3>
          <div style={{ display: "flex", gap: "8px" }}>
            {metrics.weekday_performance.map((day) => {
              const winRateMax = Math.max(...metrics.weekday_performance.map(w => w.win_rate), 0.01);
              const winRateMin = Math.min(...metrics.weekday_performance.map(w => w.win_rate), 0);
              const winRateColor = day.trade_count > 0 
                ? getWinRateHeatmapColor(day.win_rate, winRateMax, winRateMin)
                : "var(--bg-tertiary)";
              
              return (
                <div
                  key={`winrate-${day.weekday}`}
                  style={{
                    flex: 1,
                    padding: "16px",
                    backgroundColor: winRateColor,
                    borderRadius: "6px",
                    textAlign: "center",
                    border: "1px solid var(--border-color)",
                  }}
                >
                  <div style={{ fontSize: "12px", fontWeight: "600", marginBottom: "8px" }}>
                    {day.weekday_name.substring(0, 3)}
                  </div>
                  {day.trade_count === 0 ? (
                    <div
                      style={{
                        fontSize: "14px",
                        fontWeight: "bold",
                        color: "var(--text-secondary)",
                        marginBottom: "4px",
                      }}
                    >
                      No Trades
                    </div>
                  ) : (
                    <div
                      style={{
                        fontSize: "18px",
                        fontWeight: "bold",
                        color: day.win_rate >= 0.5 ? "var(--profit)" : "var(--loss)",
                        marginBottom: "4px",
                      }}
                    >
                      {(day.win_rate * 100).toFixed(1)}%
                    </div>
                  )}
                  <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                    {day.trade_count} trades
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ marginTop: "16px", padding: "12px", backgroundColor: "var(--bg-tertiary)", borderRadius: "6px" }}>
          <div style={{ fontSize: "12px", fontWeight: "600", marginBottom: "8px" }}>Risk Metrics by Weekday</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-color)" }}>
                  <th style={{ padding: "8px", textAlign: "left" }}>Day</th>
                  <th style={{ padding: "8px", textAlign: "right" }}>Avg Win</th>
                  <th style={{ padding: "8px", textAlign: "right" }}>Avg Loss</th>
                  <th style={{ padding: "8px", textAlign: "right" }}>Payoff Ratio</th>
                  <th style={{ padding: "8px", textAlign: "right" }}>Profit Factor</th>
                </tr>
              </thead>
              <tbody>
                {metrics.weekday_performance
                  .filter(d => d.trade_count > 0)
                  .map((day) => (
                    <tr key={day.weekday} style={{ borderBottom: "1px solid var(--border-color)" }}>
                      <td style={{ padding: "8px" }}>{day.weekday_name}</td>
                      <td style={{ padding: "8px", textAlign: "right", color: "var(--profit)" }}>
                        ${day.average_win.toFixed(2)}
                      </td>
                      <td style={{ padding: "8px", textAlign: "right", color: "var(--loss)" }}>
                        ${day.average_loss.toFixed(2)}
                      </td>
                      <td style={{ padding: "8px", textAlign: "right" }}>
                        {day.payoff_ratio.toFixed(2)}
                      </td>
                      <td style={{ padding: "8px", textAlign: "right" }}>
                        {day.profit_factor.toFixed(2)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Day of Month Performance Heatmap */}
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
          Day of Month Performance
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "4px", marginBottom: "16px" }}>
          {metrics.day_of_month_performance.map((day) => {
            const color = getHeatmapColor(day.total_pnl, dayOfMonthMax, dayOfMonthMin);
            
            return (
              <div
                key={day.day}
                style={{
                  padding: "8px 4px",
                  backgroundColor: day.trade_count > 0 ? color : "var(--bg-tertiary)",
                  borderRadius: "4px",
                  textAlign: "center",
                  border: day.trade_count > 0 ? "1px solid var(--border-color)" : "none",
                  opacity: day.trade_count > 0 ? 1 : 0.3,
                }}
                title={`Day ${day.day}: $${day.total_pnl.toFixed(2)} (${day.trade_count} trades)`}
              >
                <div style={{ fontSize: "10px", fontWeight: "600" }}>{day.day}</div>
                {day.trade_count > 0 && (
                  <>
                    <div
                      style={{
                        fontSize: "11px",
                        color: day.total_pnl === 0 ? "var(--text-primary)" : day.total_pnl > 0 ? "var(--profit)" : "var(--loss)",
                        fontWeight: "600",
                      }}
                    >
                      ${day.total_pnl.toFixed(0)}
                    </div>
                    <div style={{ fontSize: "9px", color: "var(--text-secondary)" }}>
                      {day.trade_count}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Time of Day Performance */}
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
          Time of Day Performance
        </h2>
        <div style={{ display: "flex", gap: "4px", marginBottom: "16px", flexWrap: "wrap" }}>
          {metrics.time_of_day_performance
            .filter(t => t.trade_count > 0)
            .map((time) => {
              const color = getHeatmapColor(time.total_pnl, timeOfDayMax, timeOfDayMin);
              const barHeight = Math.abs(time.total_pnl) / Math.max(Math.abs(timeOfDayMax), Math.abs(timeOfDayMin)) * 100;
              
              return (
                <div
                  key={time.hour}
                  style={{
                    flex: "1 1 80px",
                    minWidth: "80px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                  }}
                >
                  <div
                    style={{
                      width: "100%",
                      height: `${Math.max(barHeight, 5)}px`,
                      backgroundColor: color,
                      borderRadius: "4px 4px 0 0",
                      marginBottom: "4px",
                    }}
                  />
                  <div style={{ fontSize: "10px", fontWeight: "600", marginBottom: "2px" }}>
                    {time.hour_label.split("-")[0]}
                  </div>
                  <div
                    style={{
                      fontSize: "12px",
                      fontWeight: "600",
                      color: time.total_pnl === 0 ? "var(--text-primary)" : time.total_pnl > 0 ? "var(--profit)" : "var(--loss)",
                    }}
                  >
                    ${time.total_pnl.toFixed(2)}
                  </div>
                  <div style={{ fontSize: "10px", color: "var(--text-secondary)" }}>
                    {time.trade_count} trades
                  </div>
                  <div style={{ fontSize: "10px", color: "var(--text-secondary)" }}>
                    {(time.win_rate * 100).toFixed(0)}% win
                  </div>
                </div>
              );
            })}
        </div>
        <div style={{ marginTop: "16px", padding: "12px", backgroundColor: "var(--bg-tertiary)", borderRadius: "6px" }}>
          <div style={{ fontSize: "12px", fontWeight: "600", marginBottom: "8px" }}>Risk Metrics by Time of Day</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-color)" }}>
                  <th style={{ padding: "8px", textAlign: "left" }}>Time</th>
                  <th style={{ padding: "8px", textAlign: "right" }}>Avg Win</th>
                  <th style={{ padding: "8px", textAlign: "right" }}>Avg Loss</th>
                  <th style={{ padding: "8px", textAlign: "right" }}>Payoff Ratio</th>
                  <th style={{ padding: "8px", textAlign: "right" }}>Profit Factor</th>
                </tr>
              </thead>
              <tbody>
                {metrics.time_of_day_performance
                  .filter(t => t.trade_count > 0)
                  .map((time) => (
                    <tr key={time.hour} style={{ borderBottom: "1px solid var(--border-color)" }}>
                      <td style={{ padding: "8px" }}>{time.hour_label}</td>
                      <td style={{ padding: "8px", textAlign: "right", color: "var(--profit)" }}>
                        ${time.average_win.toFixed(2)}
                      </td>
                      <td style={{ padding: "8px", textAlign: "right", color: "var(--loss)" }}>
                        ${time.average_loss.toFixed(2)}
                      </td>
                      <td style={{ padding: "8px", textAlign: "right" }}>
                        {time.payoff_ratio.toFixed(2)}
                      </td>
                      <td style={{ padding: "8px", textAlign: "right" }}>
                        {time.profit_factor.toFixed(2)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Symbol Performance */}
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
          Symbol Performance
        </h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border-color)", backgroundColor: "var(--bg-tertiary)" }}>
                <th style={{ padding: "12px", textAlign: "left" }}>Symbol</th>
                <th style={{ padding: "12px", textAlign: "right" }}>Trades</th>
                <th style={{ padding: "12px", textAlign: "right" }}>Win Rate</th>
                <th style={{ padding: "12px", textAlign: "right" }}>Total P&L</th>
                <th style={{ padding: "12px", textAlign: "right" }}>Avg P&L</th>
                <th style={{ padding: "12px", textAlign: "right" }}>Avg Win</th>
                <th style={{ padding: "12px", textAlign: "right" }}>Avg Loss</th>
                <th style={{ padding: "12px", textAlign: "right" }}>Payoff Ratio</th>
                <th style={{ padding: "12px", textAlign: "right" }}>Profit Factor</th>
              </tr>
            </thead>
            <tbody>
              {metrics.symbol_performance.map((symbol, idx) => (
                <tr
                  key={symbol.symbol}
                  style={{
                    borderBottom: "1px solid var(--border-color)",
                    backgroundColor: idx % 2 === 0 ? "transparent" : "var(--bg-tertiary)",
                  }}
                >
                  <td style={{ padding: "12px", fontWeight: "600" }}>{symbol.symbol}</td>
                  <td style={{ padding: "12px", textAlign: "right" }}>{symbol.trade_count}</td>
                  <td style={{ padding: "12px", textAlign: "right" }}>
                    {(symbol.win_rate * 100).toFixed(1)}%
                  </td>
                  <td
                    style={{
                      padding: "12px",
                      textAlign: "right",
                      fontWeight: "600",
                      color: symbol.total_pnl === 0 ? "var(--text-primary)" : symbol.total_pnl > 0 ? "var(--profit)" : "var(--loss)",
                    }}
                  >
                    ${symbol.total_pnl.toFixed(2)}
                  </td>
                  <td
                    style={{
                      padding: "12px",
                      textAlign: "right",
                      color: symbol.average_pnl === 0 ? "var(--text-primary)" : symbol.average_pnl > 0 ? "var(--profit)" : "var(--loss)",
                    }}
                  >
                    ${symbol.average_pnl.toFixed(2)}
                  </td>
                  <td style={{ padding: "12px", textAlign: "right", color: "var(--profit)" }}>
                    ${symbol.average_win.toFixed(2)}
                  </td>
                  <td style={{ padding: "12px", textAlign: "right", color: "var(--loss)" }}>
                    ${symbol.average_loss.toFixed(2)}
                  </td>
                  <td style={{ padding: "12px", textAlign: "right" }}>
                    {symbol.payoff_ratio.toFixed(2)}
                  </td>
                  <td style={{ padding: "12px", textAlign: "right" }}>
                    {symbol.profit_factor.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Strategy Performance */}
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
          Strategy Performance
        </h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border-color)", backgroundColor: "var(--bg-tertiary)" }}>
                <th style={{ padding: "12px", textAlign: "left" }}>Strategy</th>
                <th style={{ padding: "12px", textAlign: "right" }}>Trades</th>
                <th style={{ padding: "12px", textAlign: "right" }}>Win Rate</th>
                <th style={{ padding: "12px", textAlign: "right" }}>Total P&L</th>
                <th style={{ padding: "12px", textAlign: "right" }}>Avg P&L</th>
                <th style={{ padding: "12px", textAlign: "right" }}>Avg Win</th>
                <th style={{ padding: "12px", textAlign: "right" }}>Avg Loss</th>
                <th style={{ padding: "12px", textAlign: "right" }}>Payoff Ratio</th>
                <th style={{ padding: "12px", textAlign: "right" }}>Profit Factor</th>
              </tr>
            </thead>
            <tbody>
              {metrics.strategy_performance
                .filter(s => (s.strategy_name !== "Unassigned" && s.strategy_name !== "Unknown") || s.trade_count > 0)
                .map((strategy, idx) => (
                  <tr
                    key={strategy.strategy_id || "unassigned"}
                    style={{
                      borderBottom: "1px solid var(--border-color)",
                      backgroundColor: idx % 2 === 0 ? "transparent" : "var(--bg-tertiary)",
                    }}
                  >
                    <td style={{ padding: "12px", fontWeight: "600" }}>{strategy.strategy_name}</td>
                    <td style={{ padding: "12px", textAlign: "right" }}>{strategy.trade_count}</td>
                    <td style={{ padding: "12px", textAlign: "right" }}>
                      {(strategy.win_rate * 100).toFixed(1)}%
                    </td>
                    <td
                      style={{
                        padding: "12px",
                        textAlign: "right",
                        fontWeight: "600",
                        color: strategy.total_pnl === 0 ? "var(--text-primary)" : strategy.total_pnl > 0 ? "var(--profit)" : "var(--loss)",
                      }}
                    >
                      ${strategy.total_pnl.toFixed(2)}
                    </td>
                    <td
                      style={{
                        padding: "12px",
                        textAlign: "right",
                        color: strategy.average_pnl === 0 ? "var(--text-primary)" : strategy.average_pnl > 0 ? "var(--profit)" : "var(--loss)",
                      }}
                    >
                      ${strategy.average_pnl.toFixed(2)}
                    </td>
                    <td style={{ padding: "12px", textAlign: "right", color: "var(--profit)" }}>
                      ${strategy.average_win.toFixed(2)}
                    </td>
                    <td style={{ padding: "12px", textAlign: "right", color: "var(--loss)" }}>
                      ${strategy.average_loss.toFixed(2)}
                    </td>
                    <td style={{ padding: "12px", textAlign: "right" }}>
                      {strategy.payoff_ratio.toFixed(2)}
                    </td>
                    <td style={{ padding: "12px", textAlign: "right" }}>
                      {strategy.profit_factor.toFixed(2)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Distribution & Concentration Indicator */}
      {concentrationData && (
        <div
          style={{
            backgroundColor: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            borderRadius: "8px",
            padding: "20px",
            marginBottom: "30px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
            <div>
              <h2 style={{ fontSize: "20px", fontWeight: "600", marginBottom: "8px" }}>
                Distribution & Concentration Indicator
              </h2>
              <p style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "4px" }}>
                This indicator shows whether your equity is built from many consistent trades or a small number of outsized "lottery" trades.
              </p>
              <p style={{ fontSize: "14px", color: "var(--text-secondary)" }}>
                It answers: How are my trade results distributed? What percentage of my trades generates most of my profit or losses?
              </p>
            </div>
            <div style={{ position: "relative" }}>
              <button
                ref={concentrationSettingsButtonRef}
                onClick={() => setShowConcentrationSettings(!showConcentrationSettings)}
                style={{
                  background: "var(--bg-tertiary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px",
                  padding: "6px",
                  color: "var(--text-primary)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                title="Settings"
              >
                <Settings size={16} />
              </button>
              {showConcentrationSettings && concentrationSettingsButtonRef.current && (() => {
                const rect = concentrationSettingsButtonRef.current!.getBoundingClientRect();
                return createPortal(
                  <div
                    ref={concentrationSettingsRef}
                    data-settings-menu
                    style={{
                      position: "fixed",
                      top: rect.bottom + 8,
                      right: window.innerWidth - rect.right,
                      backgroundColor: "var(--bg-secondary)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "8px",
                      padding: "12px",
                      minWidth: "200px",
                      zIndex: 1000,
                      boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
                    }}
                  >
                    <div style={{ marginBottom: "12px", fontSize: "14px", fontWeight: "600" }}>
                      Concentration Settings
                    </div>
                    <label style={{ display: "block", marginBottom: "8px", fontSize: "14px" }}>
                      Top % of trades used for analysis:
                      <select
                        value={concentrationPercent}
                        onChange={(e) => {
                          const value = parseInt(e.target.value, 10);
                          setConcentrationPercent(value);
                          localStorage.setItem("tradebutler_concentration_percent", value.toString());
                        }}
                        onFocus={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                        style={{
                          marginTop: "4px",
                          width: "100%",
                          padding: "6px",
                          backgroundColor: "var(--bg-tertiary)",
                          border: "1px solid var(--border-color)",
                          borderRadius: "4px",
                          color: "var(--text-primary)",
                          cursor: "pointer",
                        }}
                      >
                        {Array.from({ length: 26 }, (_, i) => i + 5).map((value) => (
                          <option key={value} value={value}>
                            {value}%
                          </option>
                        ))}
                      </select>
                    </label>
                    <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                      Default: 10%
                    </div>
                  </div>,
                  document.body
                );
              })()}
            </div>
          </div>

          {/* Histogram */}
          {concentrationData.histogram.length > 0 && (
            <div style={{ marginBottom: "30px" }}>
              <h3 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "12px" }}>
                Distribution of Returns
              </h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={concentrationData.histogram.map(bin => ({
                  range: `$${bin.bin_start.toFixed(0)} - $${bin.bin_end.toFixed(0)}`,
                  count: bin.count,
                  total_pnl: bin.total_pnl,
                }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                  <XAxis 
                    dataKey="range" 
                    angle={-45}
                    textAnchor="end"
                    height={80}
                    tick={{ fill: "var(--text-secondary)", fontSize: 12 }}
                  />
                  <YAxis tick={{ fill: "var(--text-secondary)", fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--bg-secondary)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "4px",
                      color: "var(--text-primary)",
                    }}
                  />
                  <Bar dataKey="count" fill="var(--text-primary)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Concentration Summary */}
          <div style={{ marginBottom: "30px" }}>
            <h3 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "12px" }}>
              Concentration Summary
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
              <div
                style={{
                  backgroundColor: "var(--bg-tertiary)",
                  padding: "16px",
                  borderRadius: "6px",
                  border: "1px solid var(--border-color)",
                }}
              >
                <div style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "8px" }}>
                  Profit Concentration
                </div>
                <div style={{ fontSize: "18px", fontWeight: "600", color: "var(--profit)" }}>
                  Top {concentrationPercent}% of winning trades generate{" "}
                  {(concentrationData.concentration.profit_share_top * 100).toFixed(1)}% of total profit
                </div>
              </div>
              <div
                style={{
                  backgroundColor: "var(--bg-tertiary)",
                  padding: "16px",
                  borderRadius: "6px",
                  border: "1px solid var(--border-color)",
                }}
              >
                <div style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "8px" }}>
                  Loss Concentration
                </div>
                <div style={{ fontSize: "18px", fontWeight: "600", color: "var(--loss)" }}>
                  Worst {concentrationPercent}% of losing trades account for{" "}
                  {(concentrationData.concentration.loss_share_top * 100).toFixed(1)}% of total loss
                </div>
              </div>
            </div>

            {/* Stability Score */}
            <div
              style={{
                backgroundColor: "var(--bg-tertiary)",
                padding: "16px",
                borderRadius: "6px",
                border: "1px solid var(--border-color)",
                marginBottom: "16px",
              }}
            >
              <div style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "8px" }}>
                Stability Score
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                <div style={{ fontSize: "32px", fontWeight: "700", color: "var(--text-primary)" }}>
                  {concentrationData.concentration.stability_score.toFixed(0)}/100
                </div>
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      width: "100%",
                      height: "8px",
                      backgroundColor: "var(--bg-secondary)",
                      borderRadius: "4px",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${concentrationData.concentration.stability_score}%`,
                        height: "100%",
                        backgroundColor:
                          concentrationData.concentration.stability_score >= 80
                            ? "var(--profit)"
                            : concentrationData.concentration.stability_score >= 50
                            ? "#fbbf24"
                            : "var(--loss)",
                        transition: "width 0.3s",
                      }}
                    />
                  </div>
                </div>
              </div>
              <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "8px" }}>
                {concentrationData.concentration.stability_score >= 80
                  ? "Very stable - performance is broadly supported by many trades"
                  : concentrationData.concentration.stability_score >= 50
                  ? "Moderate stability - some concentration risk present"
                  : "High variance - results depend heavily on a few trades"}
              </div>
            </div>

            {/* Statistics */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px" }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>
                  Total Trades
                </div>
                <div style={{ fontSize: "18px", fontWeight: "600" }}>
                  {concentrationData.concentration.total_trades}
                </div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>
                  Mean Return
                </div>
                <div
                  style={{
                    fontSize: "18px",
                    fontWeight: "600",
                    color:
                      concentrationData.concentration.mean_return === 0
                        ? "var(--text-primary)"
                        : concentrationData.concentration.mean_return > 0
                        ? "var(--profit)"
                        : "var(--loss)",
                  }}
                >
                  ${concentrationData.concentration.mean_return.toFixed(2)}
                </div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>
                  Median Return
                </div>
                <div
                  style={{
                    fontSize: "18px",
                    fontWeight: "600",
                    color:
                      concentrationData.concentration.median_return === 0
                        ? "var(--text-primary)"
                        : concentrationData.concentration.median_return > 0
                        ? "var(--profit)"
                        : "var(--loss)",
                  }}
                >
                  ${concentrationData.concentration.median_return.toFixed(2)}
                </div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>
                  Top Trades Quantity
                </div>
                <div style={{ fontSize: "18px", fontWeight: "600" }}>
                  {concentrationData.concentration.top_k}
                </div>
              </div>
            </div>
          </div>

          {/* Insights */}
          {concentrationData.concentration.insights.length > 0 && (
            <div>
              <h3 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "12px" }}>
                Insights
              </h3>
              <div
                style={{
                  backgroundColor: "var(--bg-tertiary)",
                  padding: "16px",
                  borderRadius: "6px",
                  border: "1px solid var(--border-color)",
                }}
              >
                {concentrationData.concentration.insights.map((insight, idx) => (
                  <div
                    key={idx}
                    style={{
                      marginBottom: idx < concentrationData.concentration.insights.length - 1 ? "12px" : "0",
                      paddingBottom: idx < concentrationData.concentration.insights.length - 1 ? "12px" : "0",
                      borderBottom:
                        idx < concentrationData.concentration.insights.length - 1
                          ? "1px solid var(--border-color)"
                          : "none",
                      fontSize: "14px",
                      lineHeight: "1.5",
                      color: "var(--text-primary)",
                    }}
                  >
                    {insight}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tilt-A-Metric */}
      {tiltData && (
        <div
          style={{
            backgroundColor: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            borderRadius: "8px",
            padding: "20px",
            marginBottom: "10px",
          }}
        >
          <div style={{ marginBottom: "8px" }}>
            <h2 style={{ fontSize: "20px", fontWeight: "600", marginBottom: "8px" }}>
              Tilt-A-Metric
            </h2>
            <p style={{ fontSize: "14px", color: "var(--text-secondary)" }}>
              Measures emotional trading after losses
            </p>
          </div>

          {/* Speedometer Gauge */}
          <div style={{ display: "flex", justifyContent: "center", marginTop: "100px", marginBottom: "20px" }}>
            <TiltGauge tiltScore={tiltData.tilt_score} tiltCategory={tiltData.tilt_category} />
          </div>

          {/* Key Stats */}
          <div style={{ marginBottom: "30px" }}>
            <h3 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "12px" }}>
              Key Statistics
            </h3>
            <div
              style={{
                backgroundColor: "var(--bg-tertiary)",
                padding: "16px",
                borderRadius: "6px",
                border: "1px solid var(--border-color)",
              }}
            >
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                <li style={{ marginBottom: "8px", fontSize: "14px" }}>
                  Win rate overall: <strong>{(tiltData.baseline_win_rate * 100).toFixed(1)}%</strong>
                </li>
                <li style={{ marginBottom: "8px", fontSize: "14px" }}>
                  Win rate after a loss: <strong>{(tiltData.win_rate_after_loss * 100).toFixed(1)}%</strong>
                </li>
                <li style={{ marginBottom: "8px", fontSize: "14px" }}>
                  Win rate after 2 losses: <strong>{(tiltData.win_rate_after_2_losses * 100).toFixed(1)}%</strong>
                </li>
                <li style={{ marginBottom: "8px", fontSize: "14px" }}>
                  Probability of another loss after a loss: <strong>{(tiltData.prob_loss_after_loss * 100).toFixed(1)}%</strong>
                </li>
                <li style={{ marginBottom: "8px", fontSize: "14px" }}>
                  Average loss growth after losing:{" "}
                  <strong>
                    {tiltData.avg_loss_normally !== 0 && tiltData.avg_loss_after_loss !== 0
                      ? `${(((Math.abs(tiltData.avg_loss_after_loss) - Math.abs(tiltData.avg_loss_normally)) / Math.abs(tiltData.avg_loss_normally)) * 100).toFixed(1)}%`
                      : "N/A"}
                  </strong>
                </li>
              </ul>
            </div>
          </div>

          {/* Daily Rule */}
          <div style={{ marginBottom: "30px" }}>
            <h3 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "12px" }}>
              Daily Rule
            </h3>
            <div
              style={{
                backgroundColor: "var(--bg-tertiary)",
                padding: "16px",
                borderRadius: "6px",
                border: "1px solid var(--border-color)",
              }}
            >
              {tiltData.recommended_streak !== null ? (
                <p style={{ fontSize: "14px", margin: 0 }}>
                  <strong>Suggested safety rule:</strong> Stop trading for the day after{" "}
                  <strong>{tiltData.recommended_streak}</strong> consecutive losing trades.
                </p>
              ) : (
                <p style={{ fontSize: "14px", margin: 0 }}>
                  No strong streak-based cutoff detected. Use a daily loss cap and monitor your behavior after losses.
                </p>
              )}
            </div>
          </div>

          {/* Coaching Lines */}
          {tiltData.coaching_lines.length > 0 && (
            <div>
              <h3 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "12px" }}>
                Insights & Recommendations
              </h3>
              <div
                style={{
                  backgroundColor: "var(--bg-tertiary)",
                  padding: "16px",
                  borderRadius: "6px",
                  border: "1px solid var(--border-color)",
                }}
              >
                {tiltData.coaching_lines.map((line, idx) => (
                  <div
                    key={idx}
                    style={{
                      marginBottom: idx < tiltData.coaching_lines.length - 1 ? "12px" : "0",
                      paddingBottom: idx < tiltData.coaching_lines.length - 1 ? "12px" : "0",
                      borderBottom:
                        idx < tiltData.coaching_lines.length - 1
                          ? "1px solid var(--border-color)"
                          : "none",
                      fontSize: "14px",
                      lineHeight: "1.5",
                      color: "var(--text-primary)",
                    }}
                  >
                    {line}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Tilt Gauge Component
function TiltGauge({ tiltScore, tiltCategory }: { tiltScore: number; tiltCategory: string }) {
  const radius = 100;
  const centerX = 120;
  const centerY = 40; // Move centerY up so arc is at the top of the container
  
  // For a semi-circle speedometer, the arc center is at the bottom
  // The arc curves upward from left to right (like the letter "n")
  const arcCenterX = centerX;
  const arcCenterY = centerY + radius; // Center of the circle is below the arc
  
  // Angle range: from 180 degrees (score 0, left) to 0 degrees (score 10, right)
  // Convert score to angle: 0 -> 180°, 10 -> 0°
  const angle = 180 - (tiltScore / 10) * 180;
  
  // Calculate section boundaries in degrees
  // Green: 0-4 -> 180° to 108° (0 to 4 out of 10)
  // Yellow: 5-6 -> 108° to 72° (5 to 6 out of 10)
  // Red: 7-10 -> 72° to 0° (7 to 10 out of 10)
  const greenEndAngle = 180 - (4 / 10) * 180; // 108°
  const yellowEndAngle = 180 - (6 / 10) * 180; // 72°

  // Calculate needle endpoint (needle points from center upward toward arc)
  const needleLength = 80;
  const angleRad = (angle * Math.PI) / 180;
  const needleEndX = arcCenterX + needleLength * Math.cos(angleRad);
  const needleEndY = arcCenterY + needleLength * Math.sin(angleRad);

  // Color based on tilt score
  const gaugeColor =
    tiltScore <= 4
      ? "var(--profit)"
      : tiltScore <= 6
      ? "#fbbf24"
      : "var(--loss)";

  // Calculate arc endpoints for each section
  // Start point (left, score 0): angle 180°
  const startAngle = 180;
  const startRad = (startAngle * Math.PI) / 180;
  const startX = arcCenterX + radius * Math.cos(startRad);
  const startY = arcCenterY + radius * Math.sin(startRad);
  
  // End point (right, score 10): angle 0°
  const endAngle = 0;
  const endRad = (endAngle * Math.PI) / 180;
  const endX = arcCenterX + radius * Math.cos(endRad);
  const endY = arcCenterY + radius * Math.sin(endRad);
  
  // Convert section boundaries to radians and calculate points on the arc
  const greenEndRad = (greenEndAngle * Math.PI) / 180;
  const yellowEndRad = (yellowEndAngle * Math.PI) / 180;
  
  // Calculate points on the arc
  const greenEndX = arcCenterX + radius * Math.cos(greenEndRad);
  const greenEndY = arcCenterY + radius * Math.sin(greenEndRad);
  const yellowEndX = arcCenterX + radius * Math.cos(yellowEndRad);
  const yellowEndY = arcCenterY + radius * Math.sin(yellowEndRad);

  return (
    <div style={{ position: "relative", width: "240px", height: "180px" }}>
      <svg 
        width="240" 
        height="180" 
        style={{ 
          overflow: "visible",
          transform: "rotate(180deg) scaleX(-1)",
          transformOrigin: "center center"
        }}
      >
        {/* Semi-circle arc background (full half-circle) */}
        <path
          d={`M ${startX} ${startY} A ${radius} ${radius} 0 0 0 ${endX} ${endY}`}
          fill="none"
          stroke="var(--bg-tertiary)"
          strokeWidth="20"
        />
        {/* Green section (0-4) */}
        <path
          d={`M ${startX} ${startY} A ${radius} ${radius} 0 0 0 ${greenEndX} ${greenEndY}`}
          fill="none"
          stroke="var(--profit)"
          strokeWidth="20"
          strokeLinecap="round"
        />
        {/* Yellow section (5-6) - from green end to yellow end */}
        <path
          d={`M ${greenEndX} ${greenEndY} A ${radius} ${radius} 0 0 0 ${yellowEndX} ${yellowEndY}`}
          fill="none"
          stroke="#fbbf24"
          strokeWidth="20"
          strokeLinecap="round"
        />
        {/* Red section (7-10) - from yellow end to final end */}
        <path
          d={`M ${yellowEndX} ${yellowEndY} A ${radius} ${radius} 0 0 0 ${endX} ${endY}`}
          fill="none"
          stroke="var(--loss)"
          strokeWidth="20"
          strokeLinecap="round"
        />
        {/* Needle */}
        <line
          x1={arcCenterX}
          y1={arcCenterY}
          x2={needleEndX}
          y2={needleEndY}
          stroke={gaugeColor}
          strokeWidth="3"
          strokeLinecap="round"
        />
        {/* Center dot */}
        <circle cx={arcCenterX} cy={arcCenterY} r="6" fill={gaugeColor} />
      </svg>
      {/* Score display - positioned below the gauge arc */}
      <div
        style={{
          position: "absolute",
          top: `${centerY + radius + -75}px`,
          left: "50%",
          transform: "translateX(-50%)",
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: "24px",
            fontWeight: "700",
            color: gaugeColor,
            marginBottom: "8px",
          }}
        >
          {tiltScore.toFixed(1)} / 10
        </div>
        {/* Tilt Category */}
        <div
          style={{
            display: "inline-block",
            padding: "8px 20px",
            borderRadius: "6px",
            backgroundColor: "var(--bg-tertiary)",
            border: "1px solid var(--border-color)",
            fontSize: "14px",
            fontWeight: "600",
            color: gaugeColor,
            whiteSpace: "nowrap",
            minWidth: "160px",
          }}
        >
          {tiltCategory}
        </div>
      </div>
    </div>
  );
}

