import { DataMode } from "./utils/dataMode";

// Shared lightweight interfaces aligned with page expectations
export interface ExampleTrade {
  id: number;
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  timestamp: string;
  order_type: string;
  status: string;
  fees: number | null;
  notes: string | null;
  strategy_id: number | null;
}

export interface ExampleStrategy {
  id: number;
  name: string;
  description: string | null;
  notes: string | null;
  created_at: string | null;
  color: string | null;
}

export interface ExampleJournalEntry {
  id: number;
  date: string;
  title: string;
  strategy_id: number | null;
  created_at: string | null;
  updated_at: string | null;
  linked_trade_ids?: string | null;
}

export interface ExampleJournalTrade {
  id: number;
  journal_entry_id: number;
  symbol: string | null;
  position: string | null;
  timeframe: string | null;
  entry_type: string | null;
  exit_type: string | null;
  trade: string | null;
  what_went_well: string | null;
  what_could_be_improved: string | null;
  emotional_state: string | null;
  notes: string | null;
  outcome: string | null;
  r_multiple?: number | null;
  trade_order: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface ExampleEmotionalState {
  id: number;
  timestamp: string;
  emotion: string;
  intensity: number;
  notes: string | null;
  trade_id: number | null;
}

// Basic structures used by Analytics page
export interface ExampleSymbolPnL {
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

export interface ExampleEquityPoint {
  date: string;
  cumulative_pnl: number;
  daily_pnl: number;
  peak_equity: number;
  drawdown: number;
  drawdown_pct: number;
  is_winning_streak: boolean;
  is_losing_streak: boolean;
  is_max_drawdown: boolean;
  is_best_surge: boolean;
}

export interface ExampleDrawdownMetrics {
  max_drawdown: number;
  max_drawdown_pct: number;
  max_drawdown_start: string | null;
  max_drawdown_end: string | null;
  avg_drawdown: number;
  longest_drawdown_days: number;
  longest_drawdown_start: string | null;
  longest_drawdown_end: string | null;
}

export interface ExampleEquityCurveData {
  equity_points: ExampleEquityPoint[];
  drawdown_metrics: ExampleDrawdownMetrics;
  best_surge_start: string | null;
  best_surge_end: string | null;
  best_surge_value: number;
}

// --- Example datasets (one year: Mar 5, 2025 – Mar 4, 2026) ---

import {
  EXAMPLE_TRADES_YEAR,
  EXAMPLE_JOURNAL_ENTRIES_YEAR,
  EXAMPLE_JOURNAL_TRADES_YEAR,
  EXAMPLE_EMOTIONAL_STATES_YEAR,
  EXAMPLE_JOURNAL_ENTRY_PAIRS_YEAR,
  EXAMPLE_METRICS_YEAR,
  EXAMPLE_STRATEGY_PERFORMANCE_YEAR,
  EXAMPLE_RECENT_TRADES_YEAR,
  EXAMPLE_SYMBOL_PNL_YEAR,
  EXAMPLE_EQUITY_CURVE_YEAR,
} from "./data/sandboxYearData";

export const EXAMPLE_TRADES: ExampleTrade[] = EXAMPLE_TRADES_YEAR as unknown as ExampleTrade[];
export const EXAMPLE_JOURNAL_ENTRIES: ExampleJournalEntry[] = EXAMPLE_JOURNAL_ENTRIES_YEAR as unknown as ExampleJournalEntry[];
export const EXAMPLE_JOURNAL_TRADES: ExampleJournalTrade[] = EXAMPLE_JOURNAL_TRADES_YEAR as unknown as ExampleJournalTrade[];
export const EXAMPLE_EMOTIONAL_STATES: ExampleEmotionalState[] = EXAMPLE_EMOTIONAL_STATES_YEAR as unknown as ExampleEmotionalState[];
export const EXAMPLE_JOURNAL_ENTRY_PAIRS: Record<number, { entry_trade_id: number; exit_trade_id: number }[]> = EXAMPLE_JOURNAL_ENTRY_PAIRS_YEAR;

export const EXAMPLE_STRATEGIES: ExampleStrategy[] = [
  {
    id: 1,
    name: "Opening Range Breakout",
    description: "Intraday breakout of first 30m range on large caps.",
    notes: "Trade only when ADR > 3% and premarket volume > 1M.",
    created_at: "2024-12-15T10:00:00Z",
    color: "#4ade80",
  },
  {
    id: 2,
    name: "Trend Pullback",
    description: "Higher time frame trend continuation after 38–50% pullback.",
    notes: "Use daily trend, enter on 5m confirmation.",
    created_at: "2024-12-20T11:30:00Z",
    color: "#60a5fa",
  },
  {
    id: 3,
    name: "SPY Weekly Options",
    description: "Short-dated options around key levels with strict risk.",
    notes: "1–2 trades per week, max 1R loss per idea.",
    created_at: "2024-12-22T09:45:00Z",
    color: "#f97316",
  },
  {
    id: 4,
    name: "Momentum Scalp",
    description: "Quick 1–5 min scalps on strong momentum with tight stops.",
    notes: "Only in first 90 min. Max 2R target.",
    created_at: "2025-01-05T08:00:00Z",
    color: "#a78bfa",
  },
  {
    id: 5,
    name: "Swing Breakout",
    description: "Multi-day holds on breakouts above key resistance with volume.",
    notes: "Daily/4H structure. Scale out at 1.5R, 3R.",
    created_at: "2025-01-12T09:15:00Z",
    color: "#f472b6",
  },
  {
    id: 6,
    name: "Mean Reversion",
    description: "Fade extended moves back to VWAP or moving averages.",
    notes: "Strict 2:1 R:R. No revenge trades.",
    created_at: "2025-01-18T14:00:00Z",
    color: "#34d399",
  },
];

export const EXAMPLE_SYMBOL_PNL: ExampleSymbolPnL[] = EXAMPLE_SYMBOL_PNL_YEAR as unknown as ExampleSymbolPnL[];

export const EXAMPLE_EQUITY_CURVE: ExampleEquityCurveData = EXAMPLE_EQUITY_CURVE_YEAR as unknown as ExampleEquityCurveData;

// Dashboard: metrics and recent trades (sandbox — from year data)
export const EXAMPLE_METRICS = EXAMPLE_METRICS_YEAR;
export const EXAMPLE_STRATEGY_PERFORMANCE = EXAMPLE_STRATEGY_PERFORMANCE_YEAR;
export const EXAMPLE_RECENT_TRADES = EXAMPLE_RECENT_TRADES_YEAR;

// Convenience map per mode where needed
export const EXAMPLE_MODE_LABELS: Record<DataMode, string> = {
  sandbox: "Demo",
  real: "Real",
  paper: "Paper",
};

