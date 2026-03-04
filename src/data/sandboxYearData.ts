/**
 * Generates one year of sandbox data (March 5, 2025 – March 4, 2026).
 * All data is deterministic for consistent demos.
 */

const SYMBOLS = ["AAPL", "TSLA", "SPY", "NVDA", "MSFT", "BTC", "ETH", "SOL"] as const;
const STRATEGY_IDS = [1, 2, 3, 4, 5, 6] as const;
const EMOTIONS = ["Calm", "Anxious", "Frustrated", "Excited", "Satisfied", "Confident", "Fearful", "Greedy", "Neutral", "Optimistic"] as const;
const ENTRY_TYPES = ["Breakout", "Trend continuation", "Reversal", "Pullback", "Momentum"] as const;
const EXIT_TYPES = ["Target hit", "Stop loss", "Trailing stop", "Time stop", "Mixed (partial target, then stop)"] as const;

/** ~45% of round trips are losers → ~55% win rate (deterministic from dayIdx + tripIdx) */
function isLoser(dayIdx: number, tripIdx: number): boolean {
  return ((dayIdx * 31 + tripIdx * 7) % 100) < 45;
}

/** Holding time in seconds: 1–48 hours, deterministic per (dayIdx, tripIdx) */
function holdingSeconds(dayIdx: number, tripIdx: number): number {
  const h = 3600 + ((dayIdx * 17 + tripIdx * 11) % 47) * 3600;
  return h;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toISO(date: Date): string {
  return date.toISOString().slice(0, 19) + "Z";
}

function toDateStr(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Base price by symbol index (stocks and crypto). */
function basePrice(symbolIdx: number, dayIndex: number): number {
  const bases: Record<number, number> = {
    0: 185, 1: 245, 2: 450, 3: 420, 4: 380,
    5: 97000, 6: 3500, 7: 220,
  };
  const base = bases[symbolIdx] ?? 200;
  const drift = symbolIdx >= 5
    ? Math.sin(dayIndex * 0.05) * base * 0.03
    : Math.sin(dayIndex * 0.1) * 15 + Math.sin(dayIndex * 0.03) * 8;
  return base + drift;
}

/** Entry price (deterministic). Exit price from entry and win/loss. */
function entryPrice(symbolIdx: number, dayIndex: number): number {
  const base = basePrice(symbolIdx, dayIndex);
  return Math.round(base * 100) / 100;
}

function exitPriceFromEntry(entry: number, loser: boolean, dayIdx: number, tripIdx: number): number {
  const pct = loser
    ? -0.012 - ((dayIdx + tripIdx) % 6) * 0.004   // -1.2% to -3.6% loss
    : 0.008 + ((dayIdx + tripIdx) % 5) * 0.005;  // +0.8% to +3.2% gain
  return Math.round(entry * (1 + pct) * 100) / 100;
}

export interface YearTrade {
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

export interface YearJournalEntry {
  id: number;
  date: string;
  title: string;
  strategy_id: number | null;
  created_at: string | null;
  updated_at: string | null;
  linked_trade_ids?: string | null;
}

export interface YearJournalTrade {
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

export interface YearEmotionalState {
  id: number;
  timestamp: string;
  emotion: string;
  intensity: number;
  notes: string | null;
  trade_id: number | null;
}

export function getYearOfSandboxData(): {
  trades: YearTrade[];
  journalEntries: YearJournalEntry[];
  journalTrades: YearJournalTrade[];
  emotionalStates: YearEmotionalState[];
  journalEntryPairs: Record<number, { entry_trade_id: number; exit_trade_id: number }[]>;
} {
  const start = new Date("2025-03-05T00:00:00Z");
  const end = new Date("2026-03-04T23:59:59Z");
  const trades: YearTrade[] = [];
  const journalEntries: YearJournalEntry[] = [];
  const journalTrades: YearJournalTrade[] = [];
  const emotionalStates: YearEmotionalState[] = [];
  const journalEntryPairs: Record<number, { entry_trade_id: number; exit_trade_id: number }[]> = {};
  let tradeId = 1;
  let journalEntryId = 1;
  let journalTradeId = 1;
  let emotionalStateId = 1;

  for (let dayIdx = 0; dayIdx < 365; dayIdx++) {
    const d = addDays(start, dayIdx);
    if (d > end) break;
    const dateStr = toDateStr(d);
    const dayOfWeek = d.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) continue;

    const tradesPerDay = 4 + (dayIdx % 3);
    const tradesThisDay: { entryId: number; exitId: number; symbol: string; strategyId: number }[] = [];

    for (let tripIdx = 0; tripIdx < tradesPerDay; tripIdx++) {
      const symbolIdx = (dayIdx * 7 + tripIdx) % SYMBOLS.length;
      const stratIdx = (dayIdx + tripIdx * 5) % STRATEGY_IDS.length;
      const strategyId = STRATEGY_IDS[stratIdx];
      const symbol = SYMBOLS[symbolIdx];
      const qty = symbolIdx >= 5 ? [0.01, 0.05, 0.02, 0.1][(dayIdx + tripIdx) % 4] : [50, 100, 25, 75][(dayIdx + tripIdx) % 4];
      const entryPx = entryPrice(symbolIdx, dayIdx + tripIdx);
      const loser = isLoser(dayIdx, tripIdx);
      const exitPx = exitPriceFromEntry(entryPx, loser, dayIdx, tripIdx);
      const fee = 1.0 + ((dayIdx + tripIdx) % 3) * 0.5;
      const entryMs = d.getTime() + (9 * 60 * 60 * 1000) + (tripIdx * 47) * 60000;
      const holdSec = holdingSeconds(dayIdx, tripIdx);
      const exitMs = entryMs + holdSec * 1000;

      const entryTrade: YearTrade = {
        id: tradeId++,
        symbol,
        side: "BUY",
        quantity: qty,
        price: entryPx,
        timestamp: toISO(new Date(entryMs)),
        order_type: "MARKET",
        status: "FILLED",
        fees: fee,
        notes: `Entry ${dateStr} ${symbol}`,
        strategy_id: strategyId,
      };
      const exitTrade: YearTrade = {
        id: tradeId++,
        symbol,
        side: "SELL",
        quantity: qty,
        price: exitPx,
        timestamp: toISO(new Date(exitMs)),
        order_type: "LIMIT",
        status: "FILLED",
        fees: fee,
        notes: `Exit ${dateStr} ${symbol}`,
        strategy_id: strategyId,
      };
      trades.push(entryTrade, exitTrade);
      tradesThisDay.push({ entryId: entryTrade.id, exitId: exitTrade.id, symbol, strategyId });

      if (tripIdx === 0 && dayIdx % 3 === 0) {
        const pair = tradesThisDay[0];
        const created = toISO(new Date(d.getTime() + 20 * 60 * 60 * 1000));
        journalEntries.push({
          id: journalEntryId,
          date: dateStr,
          title: `${pair.symbol} ${dateStr} – ${stratIdx === 0 ? "ORB" : stratIdx === 1 ? "Pullback" : "Options"}`,
          strategy_id: pair.strategyId,
          created_at: created,
          updated_at: created,
          linked_trade_ids: `[${pair.entryId},${pair.exitId}]`,
        });
        journalEntryPairs[journalEntryId] = [{ entry_trade_id: pair.entryId, exit_trade_id: pair.exitId }];
        const outcome = loser ? "Negative" : (dayIdx % 5 === 1 ? "Mixed" : "Positive");
        journalTrades.push({
          id: journalTradeId++,
          journal_entry_id: journalEntryId,
          symbol: pair.symbol,
          position: "Long",
          timeframe: ["5m", "15m", "1D"][stratIdx],
          entry_type: ENTRY_TYPES[(dayIdx + tripIdx) % ENTRY_TYPES.length],
          exit_type: EXIT_TYPES[(dayIdx + tripIdx) % EXIT_TYPES.length],
          trade: `Traded ${pair.symbol} on ${dateStr}. ${outcome === "Positive" ? "Target hit with good R." : outcome === "Negative" ? "Stopped out." : "Partial then stop."}`,
          what_went_well: "Executed plan. Managed risk.",
          what_could_be_improved: "Could improve entry timing.",
          emotional_state: EMOTIONS[(dayIdx + tripIdx) % EMOTIONS.length] + " during trade.",
          notes: `Journal ${journalEntryId}`,
          outcome,
          r_multiple: outcome === "Positive" ? 1.5 + (dayIdx % 5) * 0.5 : outcome === "Negative" ? -1 : 0.5,
          trade_order: 0,
          created_at: created,
          updated_at: created,
        });
        journalEntryId++;
      }
    }

    const firstEntry = trades[trades.length - tradesThisDay.length * 2];
    for (let e = 0; e < 2; e++) {
      emotionalStates.push({
        id: emotionalStateId++,
        timestamp: toISO(new Date(d.getTime() + (10 + e * 4) * 60 * 60 * 1000)),
        emotion: EMOTIONS[(dayIdx + e) % EMOTIONS.length],
        intensity: 3 + (dayIdx + e) % 6,
        notes: `${dateStr} – ${EMOTIONS[(dayIdx + e) % EMOTIONS.length]} (${3 + (dayIdx + e) % 6}/10)`,
        trade_id: e === 0 && firstEntry ? firstEntry.id : null,
      });
    }
  }

  return {
    trades,
    journalEntries,
    journalTrades,
    emotionalStates,
    journalEntryPairs,
  };
}

const cached = getYearOfSandboxData();

export const EXAMPLE_TRADES_YEAR = cached.trades;
export const EXAMPLE_JOURNAL_ENTRIES_YEAR = cached.journalEntries;
export const EXAMPLE_JOURNAL_TRADES_YEAR = cached.journalTrades;
export const EXAMPLE_EMOTIONAL_STATES_YEAR = cached.emotionalStates;
export const EXAMPLE_JOURNAL_ENTRY_PAIRS_YEAR = cached.journalEntryPairs;

/** Build pairs from sequential BUY/SELL in generated trades and compute aggregates for Dashboard/Analytics. */
function getYearAggregates() {
  const trades = cached.trades;
  const pairs: { entry: YearTrade; exit: YearTrade; net: number; strategyId: number; holdSec: number; pctReturn: number }[] = [];
  for (let i = 0; i < trades.length - 1; i += 2) {
    const entry = trades[i];
    const exit = trades[i + 1];
    if (entry.side === "BUY" && exit.side === "SELL" && entry.symbol === exit.symbol) {
      const gross = (exit.price - entry.price) * entry.quantity;
      const fees = (entry.fees ?? 0) + (exit.fees ?? 0);
      const net = gross - fees;
      const holdSec = (new Date(exit.timestamp).getTime() - new Date(entry.timestamp).getTime()) / 1000;
      const pctReturn = entry.price ? ((exit.price - entry.price) / entry.price) * 100 : 0;
      pairs.push({ entry, exit, net, strategyId: entry.strategy_id ?? 0, holdSec, pctReturn });
    }
  }
  const winning = pairs.filter((p) => p.net > 0);
  const losing = pairs.filter((p) => p.net < 0);
  const totalPnl = pairs.reduce((s, p) => s + p.net, 0);
  const totalVolume = pairs.reduce((s, p) => s + p.entry.quantity * p.entry.price + p.entry.quantity * p.exit.price, 0);
  const totalHoldSec = pairs.reduce((s, p) => s + p.holdSec, 0);
  const avgHoldSec = pairs.length > 0 ? totalHoldSec / pairs.length : 0;
  const avgGainPct = winning.length > 0 ? winning.reduce((s, p) => s + p.pctReturn, 0) / winning.length : 0;
  const avgLossPct = losing.length > 0 ? losing.reduce((s, p) => s + p.pctReturn, 0) / losing.length : 0;
  const largestWinPct = winning.length ? Math.max(...winning.map((p) => p.pctReturn)) : 0;
  const largestLossPct = losing.length ? Math.min(...losing.map((p) => p.pctReturn)) : 0;
  const bySymbol = new Map<string, { count: number; pnl: number; wins: number; losses: number }>();
  for (const p of pairs) {
    const sym = p.entry.symbol.replace(/\d{6}[CP]\d+/, "SPY");
    const cur = bySymbol.get(sym) ?? { count: 0, pnl: 0, wins: 0, losses: 0 };
    cur.count += 1;
    cur.pnl += p.net;
    if (p.net > 0) cur.wins += 1;
    else if (p.net < 0) cur.losses += 1;
    bySymbol.set(sym, cur);
  }
  const byStrategy = new Map<number, { count: number; pnl: number; volume: number }>();
  for (const p of pairs) {
    const cur = byStrategy.get(p.strategyId) ?? { count: 0, pnl: 0, volume: 0 };
    cur.count += 1;
    cur.pnl += p.net;
    cur.volume += p.entry.quantity * p.entry.price;
    byStrategy.set(p.strategyId, cur);
  }
  const strategyNames: Record<number, string> = {
    1: "Opening Range Breakout",
    2: "Trend Pullback",
    3: "SPY Weekly Options",
    4: "Momentum Scalp",
    5: "Swing Breakout",
    6: "Mean Reversion",
  };
  const sortedPairs = [...pairs].sort((a, b) => new Date(b.exit.timestamp).getTime() - new Date(a.exit.timestamp).getTime());
  const recentTrades = sortedPairs.slice(0, 5).map((p) => ({
    symbol: p.entry.symbol,
    entry_timestamp: p.entry.timestamp,
    exit_timestamp: p.exit.timestamp,
    quantity: p.entry.quantity,
    entry_price: p.entry.price,
    exit_price: p.exit.price,
    net_profit_loss: p.net,
    strategy_name: strategyNames[p.strategyId] ?? "",
  }));
  // Daily P&L: one equity point per calendar day from first to last exit (trades every day → curve moves daily)
  const pnlByDay = new Map<string, number>();
  for (const p of pairs) {
    const day = p.exit.timestamp.slice(0, 10);
    pnlByDay.set(day, (pnlByDay.get(day) ?? 0) + p.net);
  }
  const sortedPairsByExit = [...pairs].sort((a, b) => new Date(a.exit.timestamp).getTime() - new Date(b.exit.timestamp).getTime());
  const firstExit = sortedPairsByExit[0]?.exit.timestamp.slice(0, 10);
  const lastExit = sortedPairsByExit[sortedPairsByExit.length - 1]?.exit.timestamp.slice(0, 10);
  let equityPoints: { date: string; cumulative_pnl: number; daily_pnl: number; peak_equity: number; drawdown: number; drawdown_pct: number; is_winning_streak: boolean; is_losing_streak: boolean; is_max_drawdown: boolean; is_best_surge: boolean }[] = [];
  let maxDd = 0;
  if (firstExit && lastExit) {
    const allDays: string[] = [];
    const d = new Date(firstExit);
    const end = new Date(lastExit);
    while (d <= end) {
      allDays.push(d.toISOString().slice(0, 10));
      d.setDate(d.getDate() + 1);
    }
    let cum = 0;
    let peak = 0;
    for (const date of allDays) {
      const dailyPnl = pnlByDay.get(date) ?? 0;
      cum += dailyPnl;
      peak = Math.max(peak, cum);
      const drawdown = peak - cum;
      if (drawdown > maxDd) maxDd = drawdown;
      equityPoints.push({
        date,
        cumulative_pnl: cum,
        daily_pnl: dailyPnl,
        peak_equity: peak,
        drawdown,
        drawdown_pct: peak > 0 ? drawdown / peak : 0,
        is_winning_streak: dailyPnl > 0,
        is_losing_streak: dailyPnl < 0,
        is_max_drawdown: false,
        is_best_surge: false,
      });
    }
  }
  const consec = (arr: { net: number }[]) => {
    let max = 0;
    let cur = 0;
    for (const p of arr) {
      if (p.net > 0) {
        cur++;
        max = Math.max(max, cur);
      } else cur = 0;
    }
    return max;
  };
  const consecLoss = (arr: { net: number }[]) => {
    let max = 0;
    let cur = 0;
    for (const p of arr) {
      if (p.net < 0) {
        cur++;
        max = Math.max(max, cur);
      } else cur = 0;
    }
    return max;
  };
  return {
    metrics: {
      total_trades: pairs.length,
      winning_trades: winning.length,
      losing_trades: losing.length,
      total_profit_loss: Math.round(totalPnl * 100) / 100,
      win_rate: pairs.length > 0 ? winning.length / pairs.length : 0,
      average_profit: winning.length > 0 ? winning.reduce((s, p) => s + p.net, 0) / winning.length : 0,
      average_loss: losing.length > 0 ? losing.reduce((s, p) => s + p.net, 0) / losing.length : 0,
      largest_win: winning.length ? Math.max(...winning.map((p) => p.net)) : 0,
      largest_loss: losing.length ? Math.min(...losing.map((p) => p.net)) : 0,
      total_volume: Math.round(totalVolume * 100) / 100,
      trades_by_symbol: Array.from(bySymbol.entries()).map(([symbol, v]) => ({ symbol, count: v.count, profit_loss: v.pnl })),
      consecutive_wins: consec(pairs),
      consecutive_losses: consecLoss(pairs),
      current_win_streak: 1,
      current_loss_streak: 0,
      strategy_win_rate: pairs.length > 0 ? winning.length / pairs.length : 0,
      strategy_winning_trades: winning.length,
      strategy_losing_trades: losing.length,
      strategy_profit_loss: totalPnl,
      strategy_consecutive_wins: consec(pairs),
      strategy_consecutive_losses: consecLoss(pairs),
      expectancy: pairs.length > 0 ? totalPnl / pairs.length : 0,
      profit_factor: losing.length > 0 ? Math.abs(winning.reduce((s, p) => s + p.net, 0) / losing.reduce((s, p) => s + p.net, 0)) : 0,
      average_trade: pairs.length > 0 ? totalPnl / pairs.length : 0,
      total_fees: trades.reduce((s, t) => s + (t.fees ?? 0), 0),
      average_holding_time_seconds: Math.round(avgHoldSec),
      average_gain_pct: Math.round(avgGainPct * 100) / 100,
      average_loss_pct: Math.round(avgLossPct * 100) / 100,
      largest_win_pct: Math.round(largestWinPct * 100) / 100,
      largest_loss_pct: Math.round(largestLossPct * 100) / 100,
    },
    strategyPerformance: [1, 2, 3, 4, 5, 6].map((id) => {
      const v = byStrategy.get(id) ?? { count: 0, pnl: 0, volume: 0 };
      return { strategy_id: id, strategy_name: strategyNames[id], trade_count: v.count, total_volume: Math.round(v.volume * 100) / 100, estimated_pnl: v.pnl };
    }),
    recentTrades,
    symbolPnL: Array.from(bySymbol.entries()).map(([symbol, v]) => ({
      symbol,
      closed_positions: v.count,
      open_position_qty: 0,
      total_gross_pnl: v.pnl,
      total_net_pnl: v.pnl,
      total_fees: 0,
      winning_trades: v.wins,
      losing_trades: v.losses,
      win_rate: v.count > 0 ? v.wins / v.count : 0,
    })),
    equityCurve: {
      equity_points: equityPoints,
      drawdown_metrics: {
        max_drawdown: maxDd,
        max_drawdown_pct: equityPoints.length ? (() => { const peakEquity = Math.max(...equityPoints.map((e) => e.peak_equity)); return peakEquity > 0 ? maxDd / peakEquity : 0; })() : 0,
        max_drawdown_start: null,
        max_drawdown_end: null,
        avg_drawdown: maxDd / 2,
        longest_drawdown_days: 0,
        longest_drawdown_start: null,
        longest_drawdown_end: null,
      },
      best_surge_start: null,
      best_surge_end: null,
      best_surge_value: 0,
    },
  };
}

const aggregates = getYearAggregates();
export const EXAMPLE_METRICS_YEAR = aggregates.metrics;
export const EXAMPLE_STRATEGY_PERFORMANCE_YEAR = aggregates.strategyPerformance;
export const EXAMPLE_RECENT_TRADES_YEAR = aggregates.recentTrades;
export const EXAMPLE_SYMBOL_PNL_YEAR = aggregates.symbolPnL;
export const EXAMPLE_EQUITY_CURVE_YEAR = aggregates.equityCurve;
