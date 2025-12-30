import { useEffect, useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { TimeframeSelector, Timeframe, getTimeframeDates } from "../components/TimeframeSelector";

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

export default function Evaluation() {
  const [metrics, setMetrics] = useState<EvaluationMetrics | null>(null);
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

  const loadEvaluationData = async () => {
    try {
      setLoading(true);
      const pairingMethod = localStorage.getItem("tradebutler_pairing_method") || "FIFO";
      const { startDate, endDate } = getTimeframeDates(timeframe, customStartDate, customEndDate);
      
      const data = await invoke<EvaluationMetrics>("get_evaluation_metrics", {
        pairingMethod,
        startDate: startDate || null,
        endDate: endDate || null,
      });
      
      setMetrics(data);
    } catch (error) {
      console.error("Error loading evaluation data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEvaluationData();
  }, [timeframe, customStartDate, customEndDate]);

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
  const getHeatmapColor = (value: number, max: number, min: number): string => {
    if (value === 0) return "var(--bg-tertiary)";
    if (max === min) return value > 0 ? "var(--profit)" : "var(--loss)";
    
    const normalized = (value - min) / (max - min);
    if (normalized >= 0.5) {
      // Positive - green scale
      const intensity = (normalized - 0.5) * 2;
      return `rgba(34, 197, 94, ${0.3 + intensity * 0.7})`;
    } else {
      // Negative - red scale
      const intensity = (0.5 - normalized) * 2;
      return `rgba(239, 68, 68, ${0.3 + intensity * 0.7})`;
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
                      color: day.total_pnl >= 0 ? "var(--profit)" : "var(--loss)",
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
                ? getHeatmapColor(day.win_rate, winRateMax, winRateMin)
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
                  <div
                    style={{
                      fontSize: "18px",
                      fontWeight: "bold",
                      color: day.win_rate >= 0.5 ? "var(--profit)" : day.win_rate > 0 ? "var(--text-primary)" : "var(--loss)",
                      marginBottom: "4px",
                    }}
                  >
                    {(day.win_rate * 100).toFixed(1)}%
                  </div>
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
                        color: day.total_pnl >= 0 ? "var(--profit)" : "var(--loss)",
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
                      color: time.total_pnl >= 0 ? "var(--profit)" : "var(--loss)",
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
                      color: symbol.total_pnl >= 0 ? "var(--profit)" : "var(--loss)",
                    }}
                  >
                    ${symbol.total_pnl.toFixed(2)}
                  </td>
                  <td
                    style={{
                      padding: "12px",
                      textAlign: "right",
                      color: symbol.average_pnl >= 0 ? "var(--profit)" : "var(--loss)",
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
                        color: strategy.total_pnl >= 0 ? "var(--profit)" : "var(--loss)",
                      }}
                    >
                      ${strategy.total_pnl.toFixed(2)}
                    </td>
                    <td
                      style={{
                        padding: "12px",
                        textAlign: "right",
                        color: strategy.average_pnl >= 0 ? "var(--profit)" : "var(--loss)",
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
    </div>
  );
}

