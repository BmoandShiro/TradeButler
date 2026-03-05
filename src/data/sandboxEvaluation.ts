/**
 * Sandbox seed data for Evaluation page (weekday/day/hour/symbol/strategy performance, concentration, tilt).
 */

export interface WeekdayPerformance {
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

export interface DayOfMonthPerformance {
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

export interface TimeOfDayPerformance {
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

export interface SymbolPerformance {
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

export interface StrategyPerformanceDetail {
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

export interface EvaluationMetrics {
  weekday_performance: WeekdayPerformance[];
  day_of_month_performance: DayOfMonthPerformance[];
  time_of_day_performance: TimeOfDayPerformance[];
  symbol_performance: SymbolPerformance[];
  strategy_performance: StrategyPerformanceDetail[];
}

export interface HistogramBin {
  bin_start: number;
  bin_end: number;
  count: number;
  total_pnl: number;
}

export interface ConcentrationStats {
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

export interface DistributionConcentrationData {
  histogram: HistogramBin[];
  concentration: ConcentrationStats;
}

export interface StreakStats {
  k: number;
  sample_size: number;
  win_rate_after_k_losses: number;
  avg_pnl_after_k_losses: number;
}

export interface TiltStats {
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

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function buildEvaluationMetrics(): EvaluationMetrics {
  const weekday_performance: WeekdayPerformance[] = WEEKDAY_NAMES.map((name, i) => ({
    weekday: i,
    weekday_name: name,
    total_pnl: i >= 1 && i <= 5 ? 800 - i * 120 + (i === 3 ? 400 : 0) : 0,
    trade_count: i >= 1 && i <= 5 ? 180 + i * 15 : 0,
    win_rate: 0.52 + (i % 3) * 0.04,
    average_win: 280 + i * 20,
    average_loss: -190 - i * 5,
    payoff_ratio: 1.2 + i * 0.05,
    profit_factor: 1.1 + i * 0.08,
    gross_profit: 45000 + i * 3000,
    gross_loss: -38000 - i * 2000,
  }));
  const day_of_month_performance: DayOfMonthPerformance[] = Array.from({ length: 31 }, (_, i) => ({
    day: i + 1,
    total_pnl: (i % 7) * 120 - 200,
    trade_count: 35 + (i % 5) * 4,
    win_rate: 0.48 + (i % 10) * 0.008,
    average_win: 260,
    average_loss: -210,
    payoff_ratio: 1.15,
    profit_factor: 1.05 + (i % 7) * 0.02,
    gross_profit: 8000 + i * 200,
    gross_loss: -7000 - i * 150,
  }));
  const time_of_day_performance: TimeOfDayPerformance[] = [
    { hour: 9, hour_label: "9:00-10:00", total_pnl: 1200, trade_count: 95, win_rate: 0.55, average_win: 320, average_loss: -200, payoff_ratio: 1.4, profit_factor: 1.35, gross_profit: 28000, gross_loss: -18000 },
    { hour: 10, hour_label: "10:00-11:00", total_pnl: 2400, trade_count: 140, win_rate: 0.58, average_win: 340, average_loss: -190, payoff_ratio: 1.5, profit_factor: 1.5, gross_profit: 42000, gross_loss: -22000 },
    { hour: 11, hour_label: "11:00-12:00", total_pnl: 800, trade_count: 88, win_rate: 0.52, average_win: 280, average_loss: -210, payoff_ratio: 1.2, profit_factor: 1.15, gross_profit: 18000, gross_loss: -16000 },
    { hour: 14, hour_label: "14:00-15:00", total_pnl: -400, trade_count: 75, win_rate: 0.48, average_win: 250, average_loss: -230, payoff_ratio: 0.95, profit_factor: 0.92, gross_profit: 12000, gross_loss: -14000 },
    { hour: 15, hour_label: "15:00-16:00", total_pnl: 600, trade_count: 82, win_rate: 0.54, average_win: 290, average_loss: -205, payoff_ratio: 1.25, profit_factor: 1.2, gross_profit: 19000, gross_loss: -17000 },
  ];
  const symbol_performance: SymbolPerformance[] = [
    { symbol: "AAPL", trade_count: 163, win_rate: 0.56, total_pnl: 966, average_pnl: 5.9, average_win: 320, average_loss: -210, payoff_ratio: 1.35, profit_factor: 1.28, gross_profit: 28000, gross_loss: -22000 },
    { symbol: "TSLA", trade_count: 163, win_rate: 0.52, total_pnl: 905, average_pnl: 5.5, average_win: 310, average_loss: -225, payoff_ratio: 1.2, profit_factor: 1.15, gross_profit: 25000, gross_loss: -21500 },
    { symbol: "SPY", trade_count: 165, win_rate: 0.54, total_pnl: 803, average_pnl: 4.9, average_win: 290, average_loss: -205, payoff_ratio: 1.28, profit_factor: 1.22, gross_profit: 24000, gross_loss: -19800 },
    { symbol: "NVDA", trade_count: 165, win_rate: 0.58, total_pnl: 2704, average_pnl: 16.4, average_win: 380, average_loss: -195, payoff_ratio: 1.55, profit_factor: 1.48, gross_profit: 35000, gross_loss: -23500 },
    { symbol: "MSFT", trade_count: 162, win_rate: 0.51, total_pnl: 420, average_pnl: 2.6, average_win: 270, average_loss: -218, payoff_ratio: 1.1, profit_factor: 1.05, gross_profit: 22000, gross_loss: -21000 },
    { symbol: "BTC", trade_count: 164, win_rate: 0.53, total_pnl: 650, average_pnl: 4.0, average_win: 305, average_loss: -208, payoff_ratio: 1.25, profit_factor: 1.18, gross_profit: 26000, gross_loss: -22000 },
    { symbol: "ETH", trade_count: 163, win_rate: 0.50, total_pnl: 180, average_pnl: 1.1, average_win: 275, average_loss: -220, payoff_ratio: 1.05, profit_factor: 1.02, gross_profit: 22000, gross_loss: -21500 },
    { symbol: "SOL", trade_count: 164, win_rate: 0.49, total_pnl: -120, average_pnl: -0.7, average_win: 260, average_loss: -235, payoff_ratio: 0.98, profit_factor: 0.95, gross_profit: 20000, gross_loss: -21000 },
  ];
  const strategy_performance: StrategyPerformanceDetail[] = [
    { strategy_id: 1, strategy_name: "Opening Range Breakout", trade_count: 218, win_rate: 0.55, total_pnl: 4200, average_pnl: 19.3, average_win: 310, average_loss: -205, payoff_ratio: 1.35, profit_factor: 1.3, gross_profit: 38000, gross_loss: -29000 },
    { strategy_id: 2, strategy_name: "Trend Pullback", trade_count: 217, win_rate: 0.52, total_pnl: 2800, average_pnl: 12.9, average_win: 295, average_loss: -215, payoff_ratio: 1.22, profit_factor: 1.18, gross_profit: 35000, gross_loss: -29800 },
    { strategy_id: 3, strategy_name: "SPY Weekly Options", trade_count: 216, win_rate: 0.54, total_pnl: 3500, average_pnl: 16.2, average_win: 320, average_loss: -198, payoff_ratio: 1.38, profit_factor: 1.28, gross_profit: 36000, gross_loss: -27800 },
    { strategy_id: 4, strategy_name: "Momentum Scalp", trade_count: 218, win_rate: 0.51, total_pnl: 1800, average_pnl: 8.3, average_win: 280, average_loss: -222, payoff_ratio: 1.12, profit_factor: 1.08, gross_profit: 30000, gross_loss: -27800 },
    { strategy_id: 5, strategy_name: "Swing Breakout", trade_count: 215, win_rate: 0.53, total_pnl: 2400, average_pnl: 11.2, average_win: 305, average_loss: -210, payoff_ratio: 1.28, profit_factor: 1.22, gross_profit: 33000, gross_loss: -28800 },
    { strategy_id: 6, strategy_name: "Mean Reversion", trade_count: 219, win_rate: 0.50, total_pnl: 950, average_pnl: 4.3, average_win: 270, average_loss: -228, payoff_ratio: 1.05, profit_factor: 1.02, gross_profit: 28000, gross_loss: -27400 },
  ];
  return {
    weekday_performance,
    day_of_month_performance,
    time_of_day_performance,
    symbol_performance,
    strategy_performance,
  };
}

function buildConcentration(): DistributionConcentrationData {
  const bins: HistogramBin[] = [
    { bin_start: -3, bin_end: -2.5, count: 45, total_pnl: -4200 },
    { bin_start: -2.5, bin_end: -2, count: 78, total_pnl: -6800 },
    { bin_start: -2, bin_end: -1.5, count: 120, total_pnl: -9500 },
    { bin_start: -1.5, bin_end: -1, count: 95, total_pnl: -6200 },
    { bin_start: -1, bin_end: -0.5, count: 88, total_pnl: -3800 },
    { bin_start: -0.5, bin_end: 0, count: 82, total_pnl: -1800 },
    { bin_start: 0, bin_end: 0.5, count: 95, total_pnl: 2200 },
    { bin_start: 0.5, bin_end: 1, count: 110, total_pnl: 4800 },
    { bin_start: 1, bin_end: 1.5, count: 125, total_pnl: 7200 },
    { bin_start: 1.5, bin_end: 2, count: 98, total_pnl: 6500 },
    { bin_start: 2, bin_end: 2.5, count: 65, total_pnl: 4200 },
    { bin_start: 2.5, bin_end: 3, count: 38, total_pnl: 2800 },
  ];
  return {
    histogram: bins,
    concentration: {
      total_trades: 1057,
      profitable_trades_count: 551,
      losing_trades_count: 506,
      top_k: 10,
      profit_share_top: 0.28,
      loss_share_top: 0.22,
      mean_return: 0.12,
      median_return: 0.05,
      stability_score: 0.72,
      insights: [
        "Top 10% of trades contribute 28% of profits.",
        "Losses are slightly more concentrated than gains (22% from top 10% of losing trades).",
        "Consider tightening stops on large losers.",
      ],
    },
  };
}

function buildTilt(): TiltStats {
  return {
    baseline_win_rate: 0.55,
    win_rate_after_loss: 0.48,
    win_rate_after_win: 0.58,
    win_rate_after_2_losses: 0.44,
    avg_loss_normally: -210,
    avg_loss_after_loss: -245,
    prob_loss_after_loss: 0.58,
    tilt_score: 0.42,
    recommended_streak: 2,
    streak_stats: [
      { k: 1, sample_size: 506, win_rate_after_k_losses: 0.48, avg_pnl_after_k_losses: -12 },
      { k: 2, sample_size: 312, win_rate_after_k_losses: 0.44, avg_pnl_after_k_losses: -28 },
      { k: 3, sample_size: 185, win_rate_after_k_losses: 0.41, avg_pnl_after_k_losses: -35 },
    ],
    coaching_lines: [
      "After a loss, win rate drops to 48%. Consider a short break or one smaller size trade.",
      "After 2 consecutive losses, win rate is 44%. Step away or trade only your highest-conviction setup.",
      "Average loss after a loss is larger (-$245 vs -$210). Avoid revenge trading.",
    ],
    tilt_category: "Mild tilt",
  };
}

export const SANDBOX_EVALUATION_METRICS = buildEvaluationMetrics();
export const SANDBOX_DISTRIBUTION_CONCENTRATION = buildConcentration();
export const SANDBOX_TILT_STATS = buildTilt();
