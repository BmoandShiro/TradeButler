import {
  addMonths,
  eachMonthOfInterval,
  eachQuarterOfInterval,
  eachYearOfInterval,
  format,
  getQuarter,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfQuarter,
  startOfYear,
  subMonths,
} from "date-fns";
import type { DividendTrackerRow } from "./dividendTrackerData";
import { parseExDate } from "./dividendTrackerData";

export const DIVIDEND_CHART_RANGE_KEY = "tradebutler_dividend_tracker_chart_range";

/** Main timeline chart: hidden, cumulative running totals, or period totals at a granularity. */
export type DividendChartDisplayMode = "hidden" | "cumulative" | "monthly" | "quarterly" | "annual";

export const DIVIDEND_CHART_DISPLAY_MODE_KEY = "tradebutler_dividend_tracker_chart_display_mode";

/** @deprecated Legacy: charts shown alongside table; migrated by readDividendDashboardView. */
export const DASHBOARD_DIVIDEND_SHOW_CHARTS_KEY = "tradebutler_dashboard_dividend_show_charts";

/** Dashboard Dividend tracker: table only, table + charts, or charts only. */
export type DividendDashboardView = "table" | "split" | "charts";

export const DASHBOARD_DIVIDEND_VIEW_KEY = "tradebutler_dashboard_dividend_view";

export function readDividendDashboardView(): DividendDashboardView {
  try {
    const raw = localStorage.getItem(DASHBOARD_DIVIDEND_VIEW_KEY);
    if (raw === "table" || raw === "split" || raw === "charts") return raw;
    if (localStorage.getItem(DASHBOARD_DIVIDEND_SHOW_CHARTS_KEY) === "true") return "split";
  } catch {
    /* ignore */
  }
  return "table";
}

export function readDividendChartDisplayMode(): DividendChartDisplayMode {
  try {
    const raw = localStorage.getItem(DIVIDEND_CHART_DISPLAY_MODE_KEY);
    if (raw === "hidden" || raw === "cumulative" || raw === "monthly" || raw === "quarterly" || raw === "annual") {
      return raw;
    }
  } catch {
    /* ignore */
  }
  return "monthly";
}

export type DividendPeriodGranularity = "monthly" | "quarterly" | "annual";

function periodKeyFromDate(d: Date, granularity: DividendPeriodGranularity): string {
  if (granularity === "monthly") return format(startOfMonth(d), "yyyy-MM");
  if (granularity === "quarterly") return format(startOfQuarter(d), "yyyy-MM-dd");
  return format(startOfYear(d), "yyyy");
}

function labelFromPeriodKey(key: string, granularity: DividendPeriodGranularity): string {
  if (granularity === "monthly") {
    try {
      const d = parseISO(`${key}-01`);
      return format(d, "MMM yyyy");
    } catch {
      return key;
    }
  }
  if (granularity === "quarterly") {
    try {
      const d = parseISO(key);
      return `Q${getQuarter(d)} ${format(d, "yyyy")}`;
    } catch {
      return key;
    }
  }
  return key;
}

/** Period totals (not cumulative): income by month, quarter, or year within the range. */
export function buildDividendPeriodSeries(
  rows: DividendTrackerRow[],
  rangeStart: Date,
  rangeEnd: Date,
  today: Date,
  granularity: DividendPeriodGranularity
): { key: string; label: string; received: number; expected: number }[] {
  const rs = startOfDay(rangeStart);
  const re = startOfDay(rangeEnd);
  if (rs > re) return [];

  const periodStarts =
    granularity === "monthly"
      ? eachMonthOfInterval({ start: startOfMonth(rs), end: startOfMonth(re) })
      : granularity === "quarterly"
        ? eachQuarterOfInterval({ start: startOfQuarter(rs), end: startOfQuarter(re) })
        : eachYearOfInterval({ start: startOfYear(rs), end: startOfYear(re) });

  const bucketMap = new Map<string, { received: number; expected: number }>();
  for (const p of periodStarts) {
    const k = periodKeyFromDate(p, granularity);
    bucketMap.set(k, { received: 0, expected: 0 });
  }

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

    const k = periodKeyFromDate(eventDate, granularity);
    const bucket = bucketMap.get(k);
    if (!bucket) continue;

    if (isReceived) bucket.received += amt;
    else bucket.expected += amt;
  }

  return periodStarts.map((p) => {
    const key = periodKeyFromDate(p, granularity);
    const b = bucketMap.get(key)!;
    return {
      key,
      label: labelFromPeriodKey(key, granularity),
      received: b.received,
      expected: b.expected,
    };
  });
}

/** Running sums over calendar months in range (same buckets as monthly period totals). */
export function buildDividendCumulativeSeries(
  rows: DividendTrackerRow[],
  rangeStart: Date,
  rangeEnd: Date,
  today: Date
): { label: string; cumulativeReceived: number; cumulativeExpected: number }[] {
  const monthly = buildDividendPeriodSeries(rows, rangeStart, rangeEnd, today, "monthly");
  let cr = 0;
  let ce = 0;
  return monthly.map((m) => {
    cr += m.received;
    ce += m.expected;
    return {
      label: m.label,
      cumulativeReceived: cr,
      cumulativeExpected: ce,
    };
  });
}

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

  const monthly = buildDividendPeriodSeries(rows, rangeStart, rangeEnd, today, "monthly").map((m) => ({
    month: m.key,
    label: m.label,
    received: m.received,
    expected: m.expected,
  }));

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

    const sym = symbolMap.get(r.symbol) ?? { received: 0, expected: 0 };
    if (isReceived) sym.received += amt;
    else sym.expected += amt;
    symbolMap.set(r.symbol, sym);
  }

  const bySymbol = [...symbolMap.entries()]
    .map(([symbol, v]) => ({ symbol, received: v.received, expected: v.expected }))
    .filter((x) => x.received > 0 || x.expected > 0)
    .sort((a, b) => b.received + b.expected - (a.received + a.expected));

  return { monthly, bySymbol };
}
