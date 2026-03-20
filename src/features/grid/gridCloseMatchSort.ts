const EPS = 1e-12;

export function samePriceTick(a: number, b: number, tickSize: number): boolean {
  const tick = tickSize > 0 ? tickSize : 0.01;
  return Math.abs(a - b) <= tick / 2 + 1e-14;
}

function isPristineOpen<T extends { openQty: number; totalQuantity: number }>(a: T): boolean {
  return a.openQty + EPS >= a.totalQuantity;
}

/**
 * Long: closing SELL vs BUY lots (openPrice = buy price).
 *
 * 1) **Pristine first** — lots with no prior close on this fragment (`openQty ≈ totalQuantity`)
 *    before partially worked lots, so new sells finish untouched Unchecked rows before adding
 *    slivers to rows that are already partly filled.
 * 2) Across price ticks: higher buy price first.
 * 3) Same tick: prefer one lot that can absorb the full remaining sell; else larger fragment.
 */
export function sortBuyLotsForSellCloseLong<
  T extends { openPrice: number; openQty: number; totalQuantity: number },
>(eligible: T[], remainingCloseQty: number, tickSize: number): T[] {
  return [...eligible].sort((a, b) => {
    const aPri = isPristineOpen(a);
    const bPri = isPristineOpen(b);
    if (aPri !== bPri) return aPri ? -1 : 1;

    if (!samePriceTick(a.openPrice, b.openPrice, tickSize)) {
      return b.openPrice - a.openPrice;
    }
    const aFull = a.openQty + EPS >= remainingCloseQty;
    const bFull = b.openQty + EPS >= remainingCloseQty;
    if (aFull !== bFull) return aFull ? -1 : 1;
    return b.openQty - a.openQty;
  });
}

/**
 * Short: closing BUY vs short lots (openPrice = short entry / sell price).
 * Pristine fragments first, then lower price across ticks, then same-tick full absorption rules.
 */
export function sortSellLotsForBuyCloseShort<
  T extends { openPrice: number; openQty: number; totalQuantity: number },
>(eligible: T[], remainingCloseQty: number, tickSize: number): T[] {
  return [...eligible].sort((a, b) => {
    const aPri = isPristineOpen(a);
    const bPri = isPristineOpen(b);
    if (aPri !== bPri) return aPri ? -1 : 1;

    if (!samePriceTick(a.openPrice, b.openPrice, tickSize)) {
      return a.openPrice - b.openPrice;
    }
    const aFull = a.openQty + EPS >= remainingCloseQty;
    const bFull = b.openQty + EPS >= remainingCloseQty;
    if (aFull !== bFull) return aFull ? -1 : 1;
    return b.openQty - a.openQty;
  });
}
