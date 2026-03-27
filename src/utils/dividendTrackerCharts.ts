import { addMonths, eachMonthOfInterval, format, parseISO, startOfDay, startOfMonth, subMonths } from "date-fns";
import type { DividendTrackerRow } from "./dividendTrackerData";
import { parseExDate } from "./dividendTrackerData";

export const DIVIDEND_CHART_RANGE_KEY = "tradebutler_dividend_tracker_chart_range";

export function readDividendChartRange(): { start: string; end: string } {
  try {
    const raw = localStorage.getItem(DIVIDEND_CHART_RANGE_KEY);
    if (raw) {
      const j = JSON.parse(raw) as { start?: string; end?: string };
      if (j.start && j.end) return { start: j.start, end: j.end };
    }
  } catch {
    /* ignore */
  }
  const t = startOfDay(new Date());
  return {
    start: format(subMonths(t, 12), "yyyy-MM-dd"),
    end: format(addMonths(t, 12), "yyyy-MM-dd"),
  };
}

export function parseRangeDate(s: string): Date | null {
  if (!s?.trim()) return null;
  try {
    return startOfDay(parseISO(s.trim()));
  } catch {
    return null;
  }
}

/** Min/max calendar dates from rows (payment date, else ex-date). */
export function inferRowDateBounds(rows: DividendTrackerRow[]): { start: string; end: string } | null {
  let min: Date | null = null;
  let max: Date | null = null;
  for (const r of rows) {
    const d = parseExDate(r.paymentDate) ?? parseExDate(r.exDate);
    if (!d) continue;
    if (!min || d < min) min = d;
    if (!max || d > max) max = d;
  }
  if (!min || !max) return null;
  return { start: format(min, "yyyy-MM-dd"), end: format(max, "yyyy-MM-dd") };
}

/**
 * Green (received): payment before today, or no pay date and ex before today.
 * Blue (expected): payment on/after today, or no pay date and ex on/after today.
 * Buckets by calendar month of payment date, or ex-date if pay missing.
 */
export function buildDividendChartData(
  rows: DividendTrackerRow[],
  rangeStart: Date,
  rangeEnd: Date,
  today: Date
): {
  monthly: { month: string; label: string; received: number; expected: number }[];
  bySymbol: { symbol: string; received: number; expected: number }[];
} {
  const rs = startOfDay(rangeStart);
  const re = startOfDay(rangeEnd);
  if (rs > re) return { monthly: [], bySymbol: [] };

  const months = eachMonthOfInterval({ start: startOfMonth(rs), end: startOfMonth(re) });
  const monthlyMap = new Map<string, { received: number; expected: number }>();
  for (const m of months) {
    monthlyMap.set(format(m, "yyyy-MM"), { received: 0, expected: 0 });
  }

  const symbolMap = new Map<string, { received: number; expected: number }>();

  for (const r of rows) {
    const pay = r.paymentDate ? parseExDate(r.paymentDate) : null;
    const ex = parseExDate(r.exDate);
    const amt = r.estimatedTotal;
    if (amt == null || !Number.isFinite(amt) || amt <= 0) continue;

    const eventDate = pay ?? ex;
    if (!eventDate) continue;
    if (eventDate < rs || eventDate > re) continue;

    let isReceived: boolean;
    if (pay) {
      isReceived = pay < today;
    } else {
      isReceived = ex! < today;
    }

    const monthKey = format(startOfMonth(eventDate), "yyyy-MM");
    const bucket = monthlyMap.get(monthKey);
    if (!bucket) continue;

    const sym = symbolMap.get(r.symbol) ?? { received: 0, expected: 0 };
    if (isReceived) {
      bucket.received += amt;
      sym.received += amt;
    } else {
      bucket.expected += amt;
      sym.expected += amt;
    }
    symbolMap.set(r.symbol, sym);
  }

  const monthly = months.map((m) => {
    const key = format(m, "yyyy-MM");
    const b = monthlyMap.get(key)!;
    return {
      month: key,
      label: format(m, "MMM yyyy"),
      received: b.received,
      expected: b.expected,
    };
  });

  const bySymbol = [...symbolMap.entries()]
    .map(([symbol, v]) => ({ symbol, received: v.received, expected: v.expected }))
    .filter((x) => x.received > 0 || x.expected > 0)
    .sort((a, b) => b.received + b.expected - (a.received + a.expected));

  return { monthly, bySymbol };
}
