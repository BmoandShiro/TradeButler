/**
 * Build position groups and paired trades from a flat list of trades (FIFO or LIFO).
 * Used by Trades and Strategies pages in Sandbox mode.
 */

export interface FlatTrade {
  id: number;
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  timestamp: string;
  order_type?: string;
  status?: string;
  fees: number | null;
  notes: string | null;
  strategy_id: number | null;
}

export interface PositionGroupLike {
  entry_trade: FlatTrade;
  position_trades: FlatTrade[];
  total_pnl: number;
  final_quantity: number;
}

export interface PairedTradeLike {
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
  notes?: string | null;
}

/** Group trades by symbol, then build position groups and pairs (FIFO or LIFO). */
export function buildPositionGroupsAndPairs(
  trades: FlatTrade[],
  pairingMethod: "FIFO" | "LIFO"
): { positionGroups: PositionGroupLike[]; pairs: PairedTradeLike[] } {
  const pairs: PairedTradeLike[] = [];
  const positionGroups: PositionGroupLike[] = [];
  const bySymbol = new Map<string, FlatTrade[]>();
  for (const t of trades) {
    const list = bySymbol.get(t.symbol) || [];
    list.push(t);
    bySymbol.set(t.symbol, list);
  }

  for (const [, symbolTrades] of bySymbol) {
    const sorted = [...symbolTrades].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    const openEntries: { trade: FlatTrade; remainingQty: number; closingTrades: FlatTrade[] }[] = [];

    for (const t of sorted) {
      const side = String(t.side).toUpperCase();
      if (side === "BUY") {
        openEntries.push({ trade: t, remainingQty: t.quantity, closingTrades: [] });
      } else if (side === "SELL") {
        let toClose = t.quantity;
        while (toClose > 0 && openEntries.length > 0) {
          const open = pairingMethod === "LIFO" ? openEntries[openEntries.length - 1] : openEntries[0];
          const matchQty = Math.min(open.remainingQty, toClose);
          const entryFees = (open.trade.fees ?? 0) * (matchQty / open.trade.quantity);
          const exitFees = (t.fees ?? 0) * (matchQty / t.quantity);
          const gross = (t.price - open.trade.price) * matchQty;
          const net = gross - entryFees - exitFees;
          pairs.push({
            symbol: open.trade.symbol,
            entry_trade_id: open.trade.id,
            exit_trade_id: t.id,
            quantity: matchQty,
            entry_price: open.trade.price,
            exit_price: t.price,
            entry_timestamp: open.trade.timestamp,
            exit_timestamp: t.timestamp,
            gross_profit_loss: gross,
            entry_fees: entryFees,
            exit_fees: exitFees,
            net_profit_loss: net,
            strategy_id: open.trade.strategy_id,
            notes: t.notes ?? null,
          });
          open.remainingQty -= matchQty;
          toClose -= matchQty;
          if (open.closingTrades.indexOf(t) === -1) open.closingTrades.push(t);
          if (open.remainingQty <= 0) {
            const totalPnl = pairs
              .filter((p) => p.entry_trade_id === open.trade.id)
              .reduce((s, p) => s + p.net_profit_loss, 0);
            positionGroups.push({
              entry_trade: open.trade,
              position_trades: [open.trade, ...open.closingTrades],
              total_pnl: totalPnl,
              final_quantity: 0,
            });
            const i = openEntries.indexOf(open);
            openEntries.splice(i, 1);
          }
        }
      }
    }

    for (const open of openEntries) {
      if (open.remainingQty > 0) {
        const totalPnl = pairs
          .filter((p) => p.entry_trade_id === open.trade.id)
          .reduce((s, p) => s + p.net_profit_loss, 0);
        positionGroups.push({
          entry_trade: open.trade,
          position_trades: [open.trade, ...open.closingTrades],
          total_pnl: totalPnl,
          final_quantity: open.remainingQty,
        });
      }
    }
  }

  return { positionGroups, pairs };
}

/** Filter pairs by strategy (entry trade's strategy_id). */
export function filterPairsByStrategy(
  pairs: PairedTradeLike[],
  tradeById: Map<number, FlatTrade>,
  strategyId: number
): PairedTradeLike[] {
  return pairs.filter((p) => {
    const entry = tradeById.get(p.entry_trade_id);
    return entry && entry.strategy_id === strategyId;
  });
}
