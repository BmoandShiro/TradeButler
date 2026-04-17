import type { DataMode } from "./dataMode";
import { PLANESTATION_DEMO_STRATEGY_ID } from "./planestationConstants";

export interface Indicator {
  id: string; // uuid-ish
  kind?: "builtin" | "custom";
  name: string;
  abbreviation: string; // shown in strategy/journal UI
  description: string;
  code: string;
  createdAt: number;
  accentColor?: string;
  exampleImage?: string; // data url
  /**
   * For custom indicators only: additional qualitative signal flags the user can
   * record in the Journal (besides a numeric "Value").
   */
  otherSignals?: string[];
  /**
   * When true, the Journal renders this indicator's timeframe selection UI
   * (instead of "Value" inputs).
   */
  capturesTimeframes?: boolean;
  category?: "Custom" | "Momentum" | "Trend" | "Volatility" | "Volume" | "Structure" | "Pattern";
  /**
   * Signals-only metadata used by the Signals page to group pattern indicators.
   * Built-in candidates: "TechnicalPattern", "Candlestick".
   */
  signalGroup?: "TechnicalPattern" | "Candlestick";
}

const INDICATORS_KEY = "tradebutler_indicators_v1";
const STRATEGY_INDICATORS_KEY = "tradebutler_strategy_indicators_v1";
const STRATEGY_RULE_INDICATORS_KEY = "tradebutler_strategy_rule_indicators_v1";
const STRATEGY_RULE_TEXT_KEY = "tradebutler_strategy_rule_text_v1";
const STRATEGY_CUSTOM_RULE_SETS_KEY = "tradebutler_strategy_custom_rule_sets_v1";
const STRATEGY_RULES_ENABLED_KEY = "tradebutler_strategy_rules_enabled_v1";
const JOURNAL_INDICATOR_VALUES_KEY = "tradebutler_journal_indicator_values_v1";
const JOURNAL_INDICATOR_DIVERGENCE_KEY = "tradebutler_journal_indicator_divergence_v1";
const JOURNAL_INDICATOR_OTHER_SIGNALS_KEY = "tradebutler_journal_indicator_other_signals_v1";
const JOURNAL_TRADE_PATTERN_INDICATOR_IDS_KEY = "tradebutler_journal_trade_pattern_indicator_ids_v1";
const JOURNAL_INDICATOR_MA_FLAGS_KEY = "tradebutler_journal_indicator_ma_flags_v1";

// Default moving average lengths shown for EMA/MA signals when no user config exists yet.
const DEFAULT_MOVING_AVERAGE_LENGTHS = [50, 100, 200, 500];

const EMA_DEFAULT_LENGTHS_CONFIG_KEY = "tradebutler_ema_default_lengths_config_v1";
const MA_DEFAULT_LENGTHS_CONFIG_KEY = "tradebutler_ma_default_lengths_config_v1";

// Legacy shared CSV key (pre per-indicator config + pre enabled/disabled support).
const LEGACY_MOVING_AVERAGE_DEFAULT_LENGTHS_KEY = "tradebutler_ma_default_lengths_v1";

function parsePositiveNumberCsv(csv: string): number[] {
  const parts = csv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const out: number[] = [];
  const seen = new Set<number>();
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isFinite(n) || n <= 0) continue;
    // Keep integers for cleaner labels / consistent charting.
    const asInt = Math.trunc(n);
    if (asInt <= 0) continue;
    if (seen.has(asInt)) continue;
    seen.add(asInt);
    out.push(asInt);
  }
  return out;
}

/** How an EMA/MA length appears in the Journal when enabled. */
export type MovingAverageJournalKind = "value" | "checkbox";

export type MovingAverageLengthConfigItem = {
  len: number;
  enabled: boolean;
  /** Default "value" (numeric input). "checkbox" shows a yes/no box instead. */
  journalKind?: MovingAverageJournalKind;
  /** Optional #RRGGBB — tints this length in the journal and settings when set. */
  chipColor?: string;
};

const INDICATOR_SIGNAL_PREFS_KEY = "tradebutler_indicator_signal_prefs_v1";

export type IndicatorSignalPrefs = {
  order: string[];
  journalKindByLabel: Record<string, MovingAverageJournalKind>;
  /** Optional #RRGGBB per other-signal label — user-set in Journal settings; no automatic hash color. */
  chipColorByLabel?: Record<string, string>;
  /** Field names added only in Journal / Signals UI (not from the indicator's `otherSignals` list). */
  extraJournalFields?: string[];
  /** Names from `otherSignals` that the user removed from the journal list (can be re-added). */
  dismissedJournalFields?: string[];
};

/** Trim and cap length for a custom journal field label. */
export function normalizeJournalFieldLabel(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  return t.length > 80 ? t.slice(0, 80).trim() || null : t;
}

export function loadIndicatorSignalPrefs(indicatorId: string, otherSignals: string[]): IndicatorSignalPrefs {
  const base = (otherSignals ?? []).map((s) => String(s).trim()).filter(Boolean);
  let raw: Record<string, unknown> = {};
  if (typeof window !== "undefined") {
    try {
      const s = window.localStorage.getItem(INDICATOR_SIGNAL_PREFS_KEY);
      if (s) raw = JSON.parse(s) as typeof raw;
    } catch {
      raw = {};
    }
  }
  const stored = raw[indicatorId] as Partial<IndicatorSignalPrefs> | undefined;
  const dismissed = new Set(
    (Array.isArray(stored?.dismissedJournalFields) ? stored.dismissedJournalFields : [])
      .map((x) => String(x).trim())
      .filter(Boolean)
  );
  const extrasStored = (Array.isArray(stored?.extraJournalFields) ? stored.extraJournalFields : [])
    .map((x) => String(x).trim())
    .filter(Boolean);
  const extrasUniq = extrasStored.filter((x, i, a) => a.indexOf(x) === i && !base.includes(x));

  const baseVisible = base.filter((b) => !dismissed.has(b));
  const labelSet = new Set<string>([...baseVisible, ...extrasUniq]);
  const orderSaved = (stored?.order ?? []).filter((x) => labelSet.has(x));
  const remaining = [...baseVisible, ...extrasUniq].filter((x) => !orderSaved.includes(x));
  const order = [...orderSaved, ...remaining];

  const journalKindByLabel: Record<string, MovingAverageJournalKind> = {};
  for (const label of order) {
    const j = stored?.journalKindByLabel?.[label];
    journalKindByLabel[label] = j === "value" ? "value" : "checkbox";
  }

  const chipColorByLabel: Record<string, string> = {};
  const rawChip = stored?.chipColorByLabel;
  if (rawChip && typeof rawChip === "object") {
    for (const label of order) {
      const c = (rawChip as Record<string, unknown>)[label];
      if (typeof c === "string" && /^#[0-9A-Fa-f]{6}$/i.test(c.trim())) {
        chipColorByLabel[label] = c.trim().toUpperCase();
      }
    }
  }

  const extraJournalFields = extrasUniq.filter((e) => order.includes(e) && !base.includes(e));
  const dismissedJournalFields = base.filter((b) => dismissed.has(b));

  const out: IndicatorSignalPrefs = {
    order,
    journalKindByLabel,
    ...(Object.keys(chipColorByLabel).length ? { chipColorByLabel } : {}),
    ...(extraJournalFields.length ? { extraJournalFields } : {}),
    ...(dismissedJournalFields.length ? { dismissedJournalFields } : {}),
  };
  return out;
}

/** Add a journal-only field or restore a dismissed base field. Returns null if invalid or duplicate. */
export function addJournalFieldToPrefs(prefs: IndicatorSignalPrefs, baseOtherSignals: string[], rawLabel: string): IndicatorSignalPrefs | null {
  const norm = normalizeJournalFieldLabel(rawLabel);
  if (!norm) return null;
  const base = new Set(baseOtherSignals.map((s) => String(s).trim()).filter(Boolean));
  if (prefs.order.includes(norm)) return null;
  if (base.has(norm) && (prefs.dismissedJournalFields ?? []).includes(norm)) {
    const dismissed = (prefs.dismissedJournalFields ?? []).filter((x) => x !== norm);
    return {
      ...prefs,
      dismissedJournalFields: dismissed.length ? dismissed : undefined,
      order: [...prefs.order, norm],
      journalKindByLabel: { ...prefs.journalKindByLabel, [norm]: "checkbox" },
    };
  }
  if (base.has(norm)) return null;
  return {
    ...prefs,
    extraJournalFields: [...(prefs.extraJournalFields ?? []), norm],
    order: [...prefs.order, norm],
    journalKindByLabel: { ...prefs.journalKindByLabel, [norm]: "checkbox" },
  };
}

/** Remove a field: extras drop from list; base signals go to dismissed. */
export function removeJournalFieldFromPrefs(prefs: IndicatorSignalPrefs, baseOtherSignals: string[], label: string): IndicatorSignalPrefs {
  const base = new Set(baseOtherSignals.map((s) => String(s).trim()).filter(Boolean));
  const isExtra = (prefs.extraJournalFields ?? []).includes(label);
  const order = prefs.order.filter((x) => x !== label);
  const { [label]: _jk, ...restJk } = prefs.journalKindByLabel;
  const nextChip = { ...(prefs.chipColorByLabel ?? {}) };
  delete nextChip[label];
  const filteredExtras = (prefs.extraJournalFields ?? []).filter((x) => x !== label);
  let dismissedJournalFields = [...(prefs.dismissedJournalFields ?? [])];
  if (!isExtra && base.has(label)) {
    dismissedJournalFields = [...new Set([...dismissedJournalFields, label])];
  }
  const out: IndicatorSignalPrefs = {
    order,
    journalKindByLabel: restJk,
  };
  if (Object.keys(nextChip).length) out.chipColorByLabel = nextChip;
  if (filteredExtras.length) out.extraJournalFields = filteredExtras;
  if (dismissedJournalFields.length) out.dismissedJournalFields = dismissedJournalFields;
  return out;
}

/** Reset journal fields to match the indicator's `otherSignals` only (clear extras and dismissed). */
export function resetJournalFieldsPrefsToBase(otherSignals: string[]): IndicatorSignalPrefs {
  const base = (otherSignals ?? []).map((s) => String(s).trim()).filter(Boolean);
  const order = [...base];
  const journalKindByLabel: Record<string, MovingAverageJournalKind> = {};
  for (const label of base) {
    journalKindByLabel[label] = "checkbox";
  }
  return { order, journalKindByLabel };
}

export function saveIndicatorSignalPrefs(indicatorId: string, prefs: IndicatorSignalPrefs) {
  if (typeof window === "undefined") return;
  let raw: Record<string, IndicatorSignalPrefs> = {};
  try {
    const s = window.localStorage.getItem(INDICATOR_SIGNAL_PREFS_KEY);
    if (s) raw = JSON.parse(s) as typeof raw;
  } catch {
    raw = {};
  }
  raw[indicatorId] = prefs;
  window.localStorage.setItem(INDICATOR_SIGNAL_PREFS_KEY, JSON.stringify(raw));
  window.dispatchEvent(new CustomEvent("tradebutler:indicator-signal-prefs-changed"));
}

function dedupePositiveIntPreserveOrder(nums: number[]): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const n of nums) {
    if (!Number.isFinite(n) || n <= 0) continue;
    const asInt = Math.trunc(n);
    if (asInt <= 0) continue;
    if (seen.has(asInt)) continue;
    seen.add(asInt);
    out.push(asInt);
  }
  return out;
}

function parseLegacyCsvLengths(raw: string | null): number[] | null {
  if (!raw || !raw.trim()) return null;
  const nums = parsePositiveNumberCsv(raw);
  return nums.length ? dedupePositiveIntPreserveOrder(nums) : null;
}

function parseMovingAverageConfigJson(raw: string | null): MovingAverageLengthConfigItem[] | null {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;

    const out: MovingAverageLengthConfigItem[] = [];
    const seen = new Set<number>();
    for (const item of parsed) {
      const len =
        typeof item === "number"
          ? item
          : item && typeof item === "object" && "len" in item
            ? (item as any).len
            : typeof item === "string"
              ? Number(item)
              : null;
      const asNum = typeof len === "number" ? len : Number(len);
      if (!Number.isFinite(asNum) || Number.isNaN(asNum)) continue;
      const asInt = Math.trunc(asNum);
      if (asInt <= 0) continue;
      if (seen.has(asInt)) continue;
      seen.add(asInt);
      const enabled =
        typeof item === "object" && item !== null && "enabled" in (item as any) ? Boolean((item as any).enabled) : true;
      const jk = (item as any)?.journalKind;
      const journalKind: MovingAverageJournalKind = jk === "checkbox" ? "checkbox" : "value";
      const ccRaw = (item as any)?.chipColor;
      const ccTrim = typeof ccRaw === "string" ? ccRaw.trim() : "";
      const chipColor =
        ccTrim && /^#[0-9A-Fa-f]{6}$/i.test(ccTrim) ? ccTrim.toUpperCase() : undefined;
      out.push({ len: asInt, enabled, journalKind, ...(chipColor ? { chipColor } : {}) });
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}

function loadMovingAverageLengthsConfig(indicatorId: "ema" | "ma"): MovingAverageLengthConfigItem[] {
  const key = indicatorId === "ema" ? EMA_DEFAULT_LENGTHS_CONFIG_KEY : MA_DEFAULT_LENGTHS_CONFIG_KEY;
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(key);
      const parsed = parseMovingAverageConfigJson(raw);
      if (parsed) return parsed;

      // Legacy CSV (shared between ema/ma).
      const legacyRaw = window.localStorage.getItem(LEGACY_MOVING_AVERAGE_DEFAULT_LENGTHS_KEY);
      const legacyNums = parseLegacyCsvLengths(legacyRaw);
      if (legacyNums) return legacyNums.map((n) => ({ len: n, enabled: true, journalKind: "value" as const }));
    } catch {
      /* ignore */
    }
  }
  return DEFAULT_MOVING_AVERAGE_LENGTHS.map((n) => ({ len: n, enabled: true, journalKind: "value" as const }));
}

export function loadMovingAverageDefaultLengthsCsv(indicatorId: "ema" | "ma"): string {
  const cfg = loadMovingAverageLengthsConfig(indicatorId);
  return cfg.map((c) => c.len).join(",");
}

export function loadMovingAverageLengthsConfigForIndicator(indicatorId: "ema" | "ma"): MovingAverageLengthConfigItem[] {
  return loadMovingAverageLengthsConfig(indicatorId);
}

const BUILTIN_ACCENT_COLORS = ["#7C3AED", "#2563EB", "#0EA5E9", "#10B981", "#F59E0B", "#EF4444", "#EC4899", "#22C55E"];
const CUSTOM_ACCENT_COLOR = "#F59E0B";

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function pointsToPath(points: Array<[number, number]>): string {
  if (points.length === 0) return "";
  return points
    .map(([x, y], idx) => `${idx === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(" ");
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Built-in pattern signals: 512×288 neutral chart + caption (matches Signals page titles). */
const BUILTIN_PATTERN_THUMBNAIL_IDS = new Set<string>([
  "sfp",
  "fvg",
  "divergence",
  "harmonics",
  "ascending_triangle",
  "bearish_symmetric_triangle",
  "bullish_symmetric_triangle",
  "cup_and_handle",
  "descending_triangle",
  "falling_wedge",
  "rising_wedge",
  "flag",
  "pennant",
  "head_and_shoulders_top",
  "inverted_head_and_shoulders",
  "double_top",
  "double_bottom",
  "broadening_triangle_wedge",
  "descending_broadening_wedge",
  "right_angled_broadening_wedge",
  "three_drive_pattern",
  "quad_theory",
  "triple_bottom",
  "rounding_bottom",
  "doji",
  "hammer",
  "hanging_man",
  "shooting_star",
  "bullish_engulfing",
  "bearish_engulfing",
  "morning_star",
  "evening_star",
  "bullish_marubozu",
  "bearish_marubozu",
]);

function makeIndicatorExampleImageForId(id: string, abbreviation: string, accentColor: string, displayName?: string): string {
  const bg = "rgba(255,255,255,0.06)";
  const border = "rgba(255,255,255,0.22)";
  const grid = "rgba(255,255,255,0.10)";
  const gridPattern = "rgba(255,255,255,0.08)";
  const dotR = 5.8 + (hashString(abbreviation) % 30) / 10;
  const dotOpacity = 0.14 + (hashString(abbreviation + "_o") % 20) / 100;

  const isPatternThumb = BUILTIN_PATTERN_THUMBNAIL_IDS.has(id);
  const useLibraryChart = isPatternThumb || getIndicatorLibraryThumbnailIds().has(id);
  const w = useLibraryChart ? 512 : 360;
  const h = useLibraryChart ? 288 : 200;
  const pad = useLibraryChart ? 14 : 18;
  const captionH = useLibraryChart ? 26 : 0;
  const innerX = pad + (useLibraryChart ? 6 : 8);
  const innerY = pad + 6;
  const innerW = w - pad * 2 - (useLibraryChart ? 12 : 8);
  const innerH = h - pad * 2 - 10 - captionH;

  const x0 = innerX;
  const x1 = innerX + innerW;
  const y0 = innerY;
  const y1 = innerY + innerH;

  const accent = accentColor;
  const captionText = escapeXml((displayName ?? abbreviation).trim() || abbreviation);

  const neutralFrame = `
    <rect x="0" y="0" width="${w}" height="${h}" rx="14" fill="#1a1d24"/>
    <rect x="${pad}" y="${pad}" width="${w - pad * 2}" height="${h - pad * 2}" rx="11" fill="rgba(255,255,255,0.035)" stroke="rgba(255,255,255,0.11)"/>
    <g opacity="1">
      <path d="M ${x0} ${y0} L ${x1} ${y0}" stroke="${gridPattern}" stroke-width="1"/>
      <path d="M ${x0} ${y0 + innerH * 0.5} L ${x1} ${y0 + innerH * 0.5}" stroke="${gridPattern}" stroke-width="1"/>
      <path d="M ${x0} ${y1} L ${x1} ${y1}" stroke="${gridPattern}" stroke-width="1"/>
    </g>
  `;
  const header = useLibraryChart
    ? isPatternThumb
      ? neutralFrame
      : `
    <defs>
      <linearGradient id="fillA" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${accent}" stop-opacity="0.35"/>
        <stop offset="1" stop-color="${accent}" stop-opacity="0.05"/>
      </linearGradient>
    </defs>
    ${neutralFrame}
  `
    : `
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${accent}" stop-opacity="0.95"/>
        <stop offset="1" stop-color="${accent}" stop-opacity="0.45"/>
      </linearGradient>
      <linearGradient id="fillA" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${accent}" stop-opacity="0.35"/>
        <stop offset="1" stop-color="${accent}" stop-opacity="0.05"/>
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="${w}" height="${h}" rx="18" fill="url(#g)"/>
    <rect x="${pad}" y="${pad}" width="${w - pad * 2}" height="${h - pad * 2}" rx="14" fill="${bg}" stroke="${border}"/>
    <g opacity="1">
      <path d="M ${x0} ${y0} L ${x1} ${y0}" stroke="${grid}" stroke-width="1"/>
      <path d="M ${x0} ${y0 + innerH * 0.5} L ${x1} ${y0 + innerH * 0.5}" stroke="${grid}" stroke-width="1"/>
      <path d="M ${x0} ${y1} L ${x1} ${y1}" stroke="${grid}" stroke-width="1"/>
    </g>
  `;

  const accentLine = `stroke="${accent}" stroke-width="2.4" fill="none" stroke-linecap="round"`;
  const accentSoftLine = `stroke="${accent}" stroke-width="1.8" fill="none" stroke-linecap="round" opacity="0.7"`;

  // Map [0..1] to chart coordinates.
  const mapY = (t: number) => y1 - t * innerH;
  const mapX = (t: number) => x0 + t * innerW;

  // Generic sparkline fallback (not just text).
  const fallbackPath = pointsToPath([
    [mapX(0.05), mapY(0.22)],
    [mapX(0.18), mapY(0.48)],
    [mapX(0.35), mapY(0.35)],
    [mapX(0.52), mapY(0.64)],
    [mapX(0.68), mapY(0.52)],
    [mapX(0.85), mapY(0.74)],
    [mapX(0.95), mapY(0.58)],
  ]);

  let glyph = `
    <path d="${fallbackPath}" ${accentLine}/>
    <path d="M ${x0} ${mapY(0.5)} L ${x1} ${mapY(0.5)}" stroke="${grid}" stroke-width="1"/>
    <circle cx="${(w / 2).toFixed(2)}" cy="${(h - 22).toFixed(2)}" r="${dotR.toFixed(2)}" fill="${accent}" opacity="${dotOpacity.toFixed(2)}"/>
  `;

  switch (id) {
    case "rsi": {
      // RSI oscillator: line with 70/30 levels.
      const pts = [
        [0.06, 0.25],
        [0.18, 0.42],
        [0.32, 0.35],
        [0.46, 0.60],
        [0.60, 0.52],
        [0.72, 0.70],
        [0.86, 0.44],
        [0.95, 0.58],
      ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);
      glyph = `
        <path d="${pointsToPath(pts)}" ${accentLine}/>
        <path d="M ${x0} ${mapY(0.7)} L ${x1} ${mapY(0.7)}" stroke="rgba(255,255,255,0.28)" stroke-width="1"/>
        <path d="M ${x0} ${mapY(0.3)} L ${x1} ${mapY(0.3)}" stroke="rgba(255,255,255,0.18)" stroke-width="1"/>
      `;
      break;
    }
    case "stoch_rsi":
    case "stoch": {
      // Stochastic oscillator: two lines.
      const fast = [
        [0.06, 0.20],
        [0.18, 0.55],
        [0.32, 0.38],
        [0.46, 0.68],
        [0.60, 0.42],
        [0.72, 0.76],
        [0.86, 0.52],
        [0.95, 0.60],
      ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);
      const slow = [
        [0.06, 0.32],
        [0.18, 0.48],
        [0.32, 0.44],
        [0.46, 0.55],
        [0.60, 0.50],
        [0.72, 0.62],
        [0.86, 0.46],
        [0.95, 0.50],
      ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);
      glyph = `
        <path d="${pointsToPath(slow)}" ${accentSoftLine}/>
        <path d="${pointsToPath(fast)}" ${accentLine}/>
        <path d="M ${x0} ${mapY(0.8)} L ${x1} ${mapY(0.8)}" stroke="rgba(255,255,255,0.22)" stroke-width="1"/>
        <path d="M ${x0} ${mapY(0.2)} L ${x1} ${mapY(0.2)}" stroke="rgba(255,255,255,0.16)" stroke-width="1"/>
      `;
      break;
    }
    case "macd": {
      // MACD: histogram bars + two lines.
      const baselineY = mapY(0.5);
      const bars = [0.62, 0.45, 0.58, 0.28, 0.36, 0.16, 0.42, 0.25];
      const barW = innerW / (bars.length * 1.35);
      glyph = `
        <g>
          ${bars
            .map((v, i) => {
              const cx = x0 + (i + 0.5) * (innerW / bars.length);
              const barTop = baselineY - (v - 0.5) * (innerH * 0.85);
              const barBottom = baselineY;
              const up = v >= 0.5;
              const fill = up ? "rgba(16,185,129,0.55)" : "rgba(239,68,68,0.55)";
              return `<rect x="${(cx - barW / 2).toFixed(2)}" y="${Math.min(barTop, barBottom).toFixed(
                2
              )}" width="${barW.toFixed(2)}" height="${Math.abs(barTop - barBottom).toFixed(
                2
              )}" rx="3" fill="${fill}" />`;
            })
            .join("\n")}
        </g>
      `;

      const line1 = [
        [0.08, 0.60],
        [0.24, 0.52],
        [0.40, 0.58],
        [0.56, 0.44],
        [0.72, 0.50],
        [0.88, 0.46],
        [0.95, 0.52],
      ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);
      const line2 = [
        [0.08, 0.55],
        [0.24, 0.48],
        [0.40, 0.54],
        [0.56, 0.48],
        [0.72, 0.46],
        [0.88, 0.44],
        [0.95, 0.48],
      ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);
      glyph += `
        <path d="${pointsToPath(line1)}" ${accentLine}/>
        <path d="${pointsToPath(line2)}" stroke="rgba(255,255,255,0.75)" stroke-width="2" fill="none" stroke-linecap="round"/>
      `;
      break;
    }
    case "bollinger":
    case "bb_bandwidth":
    case "bb_percent_b": {
      // Bollinger: three bands (basis + upper/lower); add width cue for bandwidth.
      const basis = [
        [0.06, 0.48],
        [0.20, 0.54],
        [0.36, 0.40],
        [0.52, 0.62],
        [0.68, 0.52],
        [0.84, 0.66],
        [0.95, 0.56],
      ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);

      const upper = basis.map(([x, y]) => [x, y - innerH * 0.12] as [number, number]);
      const lower = basis.map(([x, y]) => [x, y + innerH * 0.12] as [number, number]);

      glyph = `
        <path d="${pointsToPath(lower)}" stroke="rgba(255,255,255,0.35)" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="${pointsToPath(upper)}" stroke="rgba(255,255,255,0.65)" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="${pointsToPath(basis)}" ${accentLine}/>
      `;
      if (id === "bb_bandwidth") {
        glyph += `
          <g opacity="0.9">
            ${[0.18, 0.26, 0.34, 0.42, 0.50, 0.58, 0.66, 0.74, 0.82]
              .map((tx, i) => {
                const v = [0.20, 0.35, 0.42, 0.28, 0.50, 0.62, 0.48, 0.56, 0.44][i];
                const cx = mapX(tx);
                const barW = innerW / 12;
                const top = mapY(0.25 + v * 0.55);
                return `<rect x="${(cx - barW / 2).toFixed(2)}" y="${top.toFixed(2)}" width="${barW.toFixed(2)}" height="${(y1 - top).toFixed(
                  2
                )}" rx="3" fill="${accent}" opacity="0.20"/>`;
              })
              .join("")}
          </g>
        `;
      }
      break;
    }
    case "money_flow":
    case "cmf": {
      // Money Flow / CMF: bars up/down around midline.
      const mid = mapY(0.5);
      const vals = [0.72, 0.42, 0.60, 0.35, 0.68, 0.30, 0.55, 0.46];
      const barW = innerW / vals.length - 4;
      glyph = `
        <g>
          ${vals
            .map((v, i) => {
              const cx = x0 + (i + 0.5) * (innerW / vals.length);
              const up = v >= 0.5;
              const valT = Math.abs(v - 0.5) * 2; // 0..1ish
              const barH = valT * innerH * 0.7;
              const yTop = up ? mid - barH : mid;
              const hBar = up ? barH : barH;
              const fill = up ? "rgba(16,185,129,0.55)" : "rgba(239,68,68,0.55)";
              return `<rect x="${(cx - barW / 2).toFixed(2)}" y="${yTop.toFixed(2)}" width="${barW.toFixed(
                2
              )}" height="${hBar.toFixed(2)}" rx="3" fill="${fill}" />`;
            })
            .join("\n")}
        </g>
      `;
      break;
    }
    case "volume":
    case "vpvr": {
      // Volume: bars with a simple "value area" highlight.
      const vals = [0.25, 0.55, 0.38, 0.70, 0.42, 0.62, 0.34, 0.76, 0.50];
      const barW = innerW / vals.length - 4;
      const base = y1;
      glyph = `
        <g>
          <rect x="${(x0 + innerW * 0.42).toFixed(2)}" y="${(y0 + innerH * 0.25).toFixed(2)}" width="${(innerW * 0.18).toFixed(
            2
          )}" height="${(innerH * 0.65).toFixed(2)}" rx="8" fill="${accent}" opacity="0.14"/>
          ${vals
            .map((v, i) => {
              const cx = x0 + (i + 0.5) * (innerW / vals.length);
              const barH = v * innerH * 0.75;
              return `<rect x="${(cx - barW / 2).toFixed(2)}" y="${(base - barH).toFixed(
                2
              )}" width="${barW.toFixed(2)}" height="${barH.toFixed(2)}" rx="3" fill="${accent}" opacity="${
                id === "vpvr" ? 0.22 : 0.30
              }"/>`;
            })
            .join("\n")}
        </g>
      `;
      break;
    }
    case "roc": {
      // ROC: centered line around midline.
      const pts = [
        [0.06, 0.52],
        [0.20, 0.62],
        [0.34, 0.50],
        [0.48, 0.58],
        [0.62, 0.44],
        [0.76, 0.56],
        [0.90, 0.48],
        [0.95, 0.54],
      ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);
      glyph = `
        <path d="${pointsToPath(pts)}" ${accentLine}/>
        <path d="M ${x0} ${mapY(0.5)} L ${x1} ${mapY(0.5)}" stroke="rgba(255,255,255,0.25)" stroke-width="1"/>
      `;
      break;
    }
    case "sma":
    case "ema":
    case "ma":
    case "wma":
    case "vwma": {
      // Moving average: a jagged price line + a smoothing MA line.
      const price = [
        [0.06, 0.40],
        [0.14, 0.60],
        [0.22, 0.48],
        [0.30, 0.70],
        [0.38, 0.44],
        [0.46, 0.62],
        [0.54, 0.50],
        [0.62, 0.66],
        [0.70, 0.52],
        [0.78, 0.74],
        [0.86, 0.56],
        [0.95, 0.66],
      ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);

      const ma = [
        [0.06, 0.48],
        [0.22, 0.55],
        [0.38, 0.54],
        [0.54, 0.56],
        [0.70, 0.58],
        [0.86, 0.60],
        [0.95, 0.62],
      ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);

      glyph = `
        <path d="${pointsToPath(price)}" stroke="rgba(255,255,255,0.30)" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="${pointsToPath(ma)}" ${accentLine}/>
      `;
      break;
    }
    case "vwap": {
      // VWAP: a steady line + highlighted cross points.
      const v = [
        [0.06, 0.44],
        [0.20, 0.50],
        [0.35, 0.46],
        [0.50, 0.56],
        [0.66, 0.52],
        [0.82, 0.60],
        [0.95, 0.55],
      ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);
      const line = pointsToPath(v);
      glyph = `
        <path d="${line}" ${accentLine}/>
        ${[0.18, 0.48, 0.74].map((tx) => {
          const cx = mapX(tx);
          const cy = mapY(0.46 + (tx % 0.2) * 0.12);
          return `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="4.5" fill="${accent}" opacity="0.75"/>`;
        }).join("")}
      `;
      break;
    }
    case "fib_levels": {
      // Fibonacci: 3 horizontal lines and a diagonal.
      glyph = `
        <path d="M ${x0} ${y0 + innerH * 0.18} L ${x1} ${y1 - innerH * 0.12}" stroke="${accent}" stroke-width="2.4" fill="none" stroke-linecap="round" opacity="0.95"/>
        <path d="M ${x0} ${mapY(0.80)} L ${x1} ${mapY(0.80)}" stroke="rgba(255,255,255,0.35)" stroke-width="2" stroke-linecap="round"/>
        <path d="M ${x0} ${mapY(0.52)} L ${x1} ${mapY(0.52)}" stroke="rgba(255,255,255,0.45)" stroke-width="2" stroke-linecap="round"/>
        <path d="M ${x0} ${mapY(0.28)} L ${x1} ${mapY(0.28)}" stroke="rgba(255,255,255,0.25)" stroke-width="2" stroke-linecap="round"/>
      `;
      break;
    }
    case "ichimoku_cloud": {
      // Ichimoku: two lines + a filled cloud between them.
      const tenkan = [
        [0.06, 0.60],
        [0.22, 0.52],
        [0.38, 0.58],
        [0.54, 0.46],
        [0.70, 0.54],
        [0.86, 0.50],
        [0.95, 0.56],
      ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);

      const kijun = [
        [0.06, 0.48],
        [0.22, 0.44],
        [0.38, 0.50],
        [0.54, 0.42],
        [0.70, 0.48],
        [0.86, 0.46],
        [0.95, 0.49],
      ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);

      const top = tenkan.map((p, i) => [p[0] + innerW * 0.02, kijun[i][1]] as [number, number]);
      const bottom = tenkan.map((p) => [p[0] + innerW * 0.02, p[1]] as [number, number]);

      const cloudPath = `M ${top.map((p) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(" L ")} L ${bottom
        .slice()
        .reverse()
        .map((p) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`)
        .join(" L ")} Z`;

      glyph = `
        <path d="${pointsToPath(tenkan)}" ${accentLine}/>
        <path d="${pointsToPath(kijun)}" stroke="rgba(255,255,255,0.75)" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="${cloudPath}" fill="url(#fillA)" stroke="rgba(255,255,255,0.18)"/>
      `;
      break;
    }
    case "supertrend": {
      // Supertrend: step-like zigzag with a trailing line.
      const pts = [
        [0.06, 0.62],
        [0.18, 0.55],
        [0.30, 0.68],
        [0.42, 0.52],
        [0.54, 0.64],
        [0.66, 0.50],
        [0.78, 0.60],
        [0.90, 0.48],
        [0.95, 0.54],
      ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);
      glyph = `
        <path d="${pointsToPath(pts)}" ${accentLine}/>
        ${[0.18, 0.42, 0.66, 0.90]
          .map((tx) => {
            const cx = mapX(tx);
            const cy = mapY(0.5 + Math.sin(tx * 10) * 0.1);
            return `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="3.8" fill="${accent}" opacity="0.8"/>`;
          })
          .join("")}
      `;
      break;
    }
    case "order_block_timeframe": {
      const zLeft = x0 + innerW * 0.18;
      const zW = innerW * 0.30;
      const zTop = mapY(0.70);
      const zBot = mapY(0.36);
      const cxOb = x0 + innerW * 0.62;
      glyph = `
        <rect x="${zLeft.toFixed(2)}" y="${Math.min(zTop, zBot).toFixed(2)}" width="${zW.toFixed(2)}" height="${Math.abs(zBot - zTop).toFixed(
          2
        )}" rx="5" fill="${accent}" opacity="0.18" stroke="rgba(255,255,255,0.28)"/>
        <text x="${(zLeft + zW / 2).toFixed(2)}" y="${mapY(0.56).toFixed(2)}" text-anchor="middle" fill="rgba(255,255,255,0.45)" font-size="11" font-family="ui-sans-serif, system-ui, sans-serif">OB</text>
        <path d="M ${cxOb.toFixed(2)} ${mapY(0.62).toFixed(2)} L ${cxOb.toFixed(2)} ${mapY(0.22).toFixed(2)}" stroke="rgba(255,255,255,0.32)" stroke-width="2" stroke-linecap="round"/>
        <rect x="${(cxOb - innerW * 0.035).toFixed(2)}" y="${Math.min(mapY(0.48), mapY(0.38)).toFixed(2)}" width="${(innerW * 0.07).toFixed(
          2
        )}" height="${Math.abs(mapY(0.38) - mapY(0.48)).toFixed(2)}" rx="2" fill="rgba(16,185,129,0.55)" stroke="rgba(255,255,255,0.15)"/>
      `;
      break;
    }
    case "elliott_wave": {
      const imp = [
        [0.06, 0.58],
        [0.20, 0.38],
        [0.34, 0.50],
        [0.48, 0.30],
        [0.62, 0.44],
        [0.76, 0.24],
        [0.90, 0.36],
      ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);
      glyph = `
        <path d="${pointsToPath(imp)}" ${accentLine}/>
        <text x="${mapX(0.12).toFixed(2)}" y="${mapY(0.72).toFixed(2)}" fill="rgba(255,255,255,0.5)" font-size="10" font-family="ui-sans-serif, system-ui, sans-serif">1</text>
        <text x="${mapX(0.26).toFixed(2)}" y="${mapY(0.32).toFixed(2)}" fill="rgba(255,255,255,0.5)" font-size="10" font-family="ui-sans-serif, system-ui, sans-serif">2</text>
        <text x="${mapX(0.40).toFixed(2)}" y="${mapY(0.58).toFixed(2)}" fill="rgba(255,255,255,0.5)" font-size="10" font-family="ui-sans-serif, system-ui, sans-serif">3</text>
        <text x="${mapX(0.54).toFixed(2)}" y="${mapY(0.22).toFixed(2)}" fill="rgba(255,255,255,0.5)" font-size="10" font-family="ui-sans-serif, system-ui, sans-serif">4</text>
        <text x="${mapX(0.82).toFixed(2)}" y="${mapY(0.28).toFixed(2)}" fill="rgba(255,255,255,0.5)" font-size="10" font-family="ui-sans-serif, system-ui, sans-serif">5</text>
      `;
      break;
    }
    case "choch_bos_timeframe": {
      glyph = `
        <path d="M ${mapX(0.08).toFixed(2)} ${mapY(0.56).toFixed(2)} L ${mapX(0.26).toFixed(2)} ${mapY(0.44).toFixed(2)} L ${mapX(0.44).toFixed(2)} ${mapY(0.52).toFixed(2)} L ${mapX(0.62).toFixed(2)} ${mapY(0.34).toFixed(2)} L ${mapX(0.80).toFixed(2)} ${mapY(0.60).toFixed(2)}"
          stroke="rgba(255,255,255,0.42)" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M ${x0} ${mapY(0.48).toFixed(2)} L ${x1} ${mapY(0.48).toFixed(2)}"
          stroke="${accent}" stroke-width="2" stroke-dasharray="7 5" stroke-linecap="round" opacity="0.9"/>
        <circle cx="${mapX(0.62).toFixed(2)}" cy="${mapY(0.34).toFixed(2)}" r="4.5" fill="${accent}" opacity="0.88"/>
      `;
      break;
    }

    // --- Pattern thumbnails (technical + candlestick) ---
    case "sfp": {
      // Swing Failure Pattern: spike + rejection back toward baseline.
      const mid = mapY(0.50);
      const top = mapY(0.22);
      const left = x0 + innerW * 0.18;
      const spike = x0 + innerW * 0.52;
      const right = x0 + innerW * 0.86;
      const reject = mapY(0.40);

      glyph = `
        <path d="M ${left.toFixed(2)} ${mid.toFixed(2)} L ${spike.toFixed(2)} ${top.toFixed(2)} L ${right.toFixed(
        2
      )} ${reject.toFixed(2)}"
          stroke="${accent}" stroke-width="2.6" fill="none" stroke-linecap="round"/>
        <path d="M ${spike.toFixed(2)} ${reject.toFixed(2)} L ${(spike + innerW * 0.12).toFixed(2)} ${mid.toFixed(
        2
      )}"
          stroke="rgba(255,255,255,0.70)" stroke-width="2" fill="none" stroke-linecap="round"/>
        <circle cx="${spike.toFixed(2)}" cy="${top.toFixed(2)}" r="4.8" fill="${accent}" opacity="0.85"/>
        <rect x="${(spike - innerW * 0.12).toFixed(2)}" y="${(reject - 6).toFixed(2)}" width="${(innerW * 0.18).toFixed(
        2
      )}" height="12" rx="6" fill="${accent}" opacity="0.16" stroke="rgba(255,255,255,0.25)"/>
      `;
      break;
    }
    case "fvg": {
      // Fair Value Gap: two candles framing an empty price region.
      const leftC = x0 + innerW * 0.30;
      const rightC = x0 + innerW * 0.70;
      const gapX = x0 + innerW * 0.48;
      const gapW = innerW * 0.18;

      const gapTop = mapY(0.42);
      const gapBottom = mapY(0.58);
      const lower = mapY(0.20);
      const upper = mapY(0.80);
      const wickStroke = "rgba(255,255,255,0.26)";

      glyph = `
        <g opacity="0.95">
          <path d="M ${(leftC).toFixed(2)} ${lower.toFixed(2)} L ${(leftC).toFixed(2)} ${upper.toFixed(2)}" stroke="${wickStroke}" stroke-width="2" stroke-linecap="round"/>
          <rect x="${(leftC - innerW * 0.08).toFixed(2)}" y="${(gapBottom).toFixed(2)}" width="${(innerW * 0.16).toFixed(
        2
      )}" height="${(lower - gapBottom).toFixed(2)}" rx="6" fill="${accent}" opacity="0.28"/>

          <path d="M ${(rightC).toFixed(2)} ${lower.toFixed(2)} L ${(rightC).toFixed(2)} ${upper.toFixed(2)}" stroke="${wickStroke}" stroke-width="2" stroke-linecap="round"/>
          <rect x="${(rightC - innerW * 0.08).toFixed(2)}" y="${(gapTop).toFixed(2)}" width="${(innerW * 0.16).toFixed(
        2
      )}" height="${(gapBottom - gapTop).toFixed(2)}" rx="6" fill="${accent}" opacity="0.16"/>

          <!-- The gap area -->
          <rect x="${(gapX - gapW / 2).toFixed(2)}" y="${gapTop.toFixed(2)}" width="${gapW.toFixed(
        2
      )}" height="${(gapBottom - gapTop).toFixed(2)}" rx="10" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.22)"/>
        </g>
      `;
      break;
    }
    case "divergence": {
      // Divergence: two lines moving away from each other.
      const left = x0 + innerW * 0.14;
      const right = x0 + innerW * 0.90;
      const y1a = mapY(0.72);
      const y1b = mapY(0.44);
      const y2a = mapY(0.40);
      const y2b = mapY(0.66);

      glyph = `
        <path d="M ${left.toFixed(2)} ${y1a.toFixed(2)} L ${(left + innerW * 0.35).toFixed(2)} ${(y1a + y1b) / 2.0}
                 L ${right.toFixed(2)} ${y1b.toFixed(2)}"
          stroke="${accent}" stroke-width="2.6" fill="none" stroke-linecap="round"/>
        <path d="M ${left.toFixed(2)} ${y2a.toFixed(2)} L ${(left + innerW * 0.35).toFixed(2)} ${(y2a + y2b) / 2.0}
                 L ${right.toFixed(2)} ${y2b.toFixed(2)}"
          stroke="rgba(255,255,255,0.72)" stroke-width="2.2" fill="none" stroke-linecap="round"/>
        <path d="M ${left.toFixed(2)} ${mapY(0.50).toFixed(2)} L ${right.toFixed(2)} ${mapY(0.50).toFixed(
        2
      )}" stroke="rgba(255,255,255,0.16)" stroke-width="1" />
        <circle cx="${right.toFixed(2)}" cy="${y1b.toFixed(2)}" r="4.2" fill="${accent}" opacity="0.90"/>
        <circle cx="${right.toFixed(2)}" cy="${y2b.toFixed(2)}" r="4.2" fill="rgba(255,255,255,0.75)" opacity="0.65"/>
      `;
      break;
    }
    case "harmonics": {
      // Generic XABCD harmonic swing + PRZ (Gartley/Bat family stand-in).
      const x = x0 + innerW * 0.10;
      const xa = x0 + innerW * 0.26;
      const xb = x0 + innerW * 0.42;
      const xc = x0 + innerW * 0.58;
      const xd = x0 + innerW * 0.82;
      const yx = mapY(0.56);
      const ya = mapY(0.38);
      const yb = mapY(0.64);
      const yc = mapY(0.36);
      const yd = mapY(0.58);
      const przLeft = xd - innerW * 0.1;
      const przTop = Math.min(yc, yd) - innerH * 0.05;
      const przH = Math.abs(yd - yc) + innerH * 0.14;
      glyph = `
        <path d="M ${x.toFixed(2)} ${yx.toFixed(2)} L ${xa.toFixed(2)} ${ya.toFixed(2)} L ${xb.toFixed(2)} ${yb.toFixed(2)} L ${xc.toFixed(2)} ${yc.toFixed(2)} L ${xd.toFixed(2)} ${yd.toFixed(2)}"
          stroke="${accent}" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        <rect x="${przLeft.toFixed(2)}" y="${przTop.toFixed(2)}" width="${(innerW * 0.12).toFixed(2)}" height="${przH.toFixed(
          2
        )}" rx="6" fill="${accent}" opacity="0.12" stroke="rgba(255,255,255,0.22)"/>
      `;
      break;
    }

    // --- Technical analysis patterns (triangles/wedges/flags/head & shoulders/etc.) ---
    case "ascending_triangle": {
      const leftX = x0 + innerW * 0.20;
      const rightX = x0 + innerW * 0.86;
      const topY = mapY(0.72); // flat resistance
      const leftBottomY = mapY(0.52); // rising support from left to right apex
      const rightBottomY = topY; // meet resistance at the right apex

      glyph = `
        <!-- Resistance (flat) -->
        <path d="M ${leftX.toFixed(2)} ${topY.toFixed(2)} L ${rightX.toFixed(2)} ${topY.toFixed(2)}"
          stroke="${accent}" stroke-width="2.6" fill="none" stroke-linecap="round"/>
        <!-- Support (rising) -->
        <path d="M ${leftX.toFixed(2)} ${leftBottomY.toFixed(2)} L ${rightX.toFixed(2)} ${rightBottomY.toFixed(2)}"
          stroke="rgba(255,255,255,0.72)" stroke-width="2.2" fill="none" stroke-linecap="round"/>
        <!-- Left side boundary -->
        <path d="M ${leftX.toFixed(2)} ${topY.toFixed(2)} L ${leftX.toFixed(2)} ${leftBottomY.toFixed(2)}"
          stroke="rgba(255,255,255,0.18)" stroke-width="2.0" fill="none" stroke-linecap="round"/>
      `;
      break;
    }
    case "descending_triangle": {
      const leftX = x0 + innerW * 0.20;
      const rightX = x0 + innerW * 0.86;
      const bottomY = mapY(0.38); // flat support
      const leftTopY = mapY(0.62); // descending resistance to bottom-right apex
      const rightTopY = bottomY;

      glyph = `
        <!-- Support (flat) -->
        <path d="M ${leftX.toFixed(2)} ${bottomY.toFixed(2)} L ${rightX.toFixed(2)} ${bottomY.toFixed(2)}"
          stroke="rgba(255,255,255,0.70)" stroke-width="2.2" fill="none" stroke-linecap="round"/>
        <!-- Resistance (descending) -->
        <path d="M ${leftX.toFixed(2)} ${leftTopY.toFixed(2)} L ${rightX.toFixed(2)} ${rightTopY.toFixed(2)}"
          stroke="${accent}" stroke-width="2.6" fill="none" stroke-linecap="round"/>
        <!-- Left side boundary -->
        <path d="M ${leftX.toFixed(2)} ${leftTopY.toFixed(2)} L ${leftX.toFixed(2)} ${bottomY.toFixed(2)}"
          stroke="rgba(255,255,255,0.18)" stroke-width="2.0" fill="none" stroke-linecap="round"/>
      `;
      break;
    }
    case "bullish_symmetric_triangle": {
      const leftX = x0 + innerW * 0.20;
      const rightX = x0 + innerW * 0.86;
      const apexY = mapY(0.30);
      const baseY = mapY(0.62);
      const midX = x0 + innerW / 2;

      glyph = `
        <!-- Base (flat) -->
        <path d="M ${leftX.toFixed(2)} ${baseY.toFixed(2)} L ${rightX.toFixed(2)} ${baseY.toFixed(2)}"
          stroke="rgba(255,255,255,0.20)" stroke-width="2.0" fill="none" stroke-linecap="round" />
        <!-- Sides converging to apex -->
        <path d="M ${leftX.toFixed(2)} ${baseY.toFixed(2)} L ${midX.toFixed(2)} ${apexY.toFixed(2)}"
          stroke="${accent}" stroke-width="2.8" fill="none" stroke-linecap="round" />
        <path d="M ${rightX.toFixed(2)} ${baseY.toFixed(2)} L ${midX.toFixed(2)} ${apexY.toFixed(2)}"
          stroke="rgba(255,255,255,0.68)" stroke-width="2.4" fill="none" stroke-linecap="round" />
      `;
      break;
    }
    case "bearish_symmetric_triangle": {
      const leftX = x0 + innerW * 0.20;
      const rightX = x0 + innerW * 0.86;
      const apexY = mapY(0.22); // bearish symmetric: apex down
      const baseY = mapY(0.40); // base up/top
      const midX = x0 + innerW / 2;

      glyph = `
        <!-- Base (flat) -->
        <path d="M ${leftX.toFixed(2)} ${baseY.toFixed(2)} L ${rightX.toFixed(2)} ${baseY.toFixed(2)}"
          stroke="rgba(255,255,255,0.20)" stroke-width="2.0" fill="none" stroke-linecap="round" />
        <!-- Sides converging downwards -->
        <path d="M ${leftX.toFixed(2)} ${baseY.toFixed(2)} L ${midX.toFixed(2)} ${apexY.toFixed(2)}"
          stroke="${accent}" stroke-width="2.8" fill="none" stroke-linecap="round" />
        <path d="M ${rightX.toFixed(2)} ${baseY.toFixed(2)} L ${midX.toFixed(2)} ${apexY.toFixed(2)}"
          stroke="rgba(255,255,255,0.68)" stroke-width="2.4" fill="none" stroke-linecap="round" />
      `;
      break;
    }
    case "cup_and_handle": {
      const leftX = x0 + innerW * 0.22;
      const rightX = x0 + innerW * 0.78;
      const rimY = mapY(0.46);
      const bottomY = mapY(0.66);
      const midX = x0 + innerW * 0.50;
      const handleTopY = mapY(0.56);
      const handleBottomY = mapY(0.68);
      glyph = `
        <path d="M ${leftX.toFixed(2)} ${rimY.toFixed(2)} Q ${midX.toFixed(2)} ${bottomY.toFixed(2)} ${rightX.toFixed(2)} ${rimY.toFixed(2)}"
          stroke="${accent}" stroke-width="2.6" fill="none" stroke-linecap="round"/>
        <rect x="${(midX - innerW * 0.06).toFixed(2)}" y="${handleTopY.toFixed(2)}" width="${(innerW * 0.12).toFixed(
          2
        )}" height="${(handleBottomY - handleTopY).toFixed(2)}" rx="6"
          fill="${accent}" opacity="0.18" stroke="rgba(255,255,255,0.22)"/>
        <path d="M ${(midX - innerW * 0.06).toFixed(2)} ${handleTopY.toFixed(2)} L ${(midX + innerW * 0.06).toFixed(2)} ${handleTopY.toFixed(2)}"
          stroke="rgba(255,255,255,0.30)" stroke-width="2" fill="none" stroke-linecap="round"/>
      `;
      break;
    }
    case "falling_wedge":
    case "rising_wedge": {
      const isRising = id === "rising_wedge";
      const leftX = x0 + innerW * 0.22;
      const rightX = x0 + innerW * 0.78;
      const apexX = x0 + innerW * 0.50;
      const leftY1 = isRising ? mapY(0.46) : mapY(0.62);
      const rightY1 = isRising ? mapY(0.56) : mapY(0.48);
      const leftY2 = isRising ? mapY(0.78) : mapY(0.40);
      const rightY2 = isRising ? mapY(0.62) : mapY(0.30);
      const accentLine = isRising ? "rgba(16,185,129,0.85)" : accent;
      glyph = `
        <path d="M ${leftX.toFixed(2)} ${leftY1.toFixed(2)} L ${apexX.toFixed(2)} ${(leftY2).toFixed(2)}"
          stroke="${accent}" stroke-width="2.6" fill="none" stroke-linecap="round"/>
        <path d="M ${rightX.toFixed(2)} ${rightY1.toFixed(2)} L ${apexX.toFixed(2)} ${(rightY2).toFixed(2)}"
          stroke="rgba(255,255,255,0.70)" stroke-width="2.2" fill="none" stroke-linecap="round"/>
        <path d="M ${apexX.toFixed(2)} ${(leftY2).toFixed(2)} L ${apexX.toFixed(2)} ${mapY(0.55).toFixed(2)}"
          stroke="${accentLine}" stroke-width="2.2" fill="none" stroke-linecap="round" opacity="0.55"/>
      `;
      break;
    }
    case "flag": {
      const poleX = x0 + innerW * 0.30;
      const poleTop = mapY(0.25);
      const poleBottom = mapY(0.70);
      const flagLeft = poleX;
      const flagTop = mapY(0.48);
      const flagBottom = mapY(0.60);
      const flagRight = x0 + innerW * 0.78;
      const flagTopR = mapY(0.44);
      const flagBottomR = mapY(0.64);
      glyph = `
        <path d="M ${poleX.toFixed(2)} ${poleTop.toFixed(2)} L ${poleX.toFixed(2)} ${poleBottom.toFixed(2)}"
          stroke="${accent}" stroke-width="2.8" fill="none" stroke-linecap="round"/>
        <path d="M ${flagLeft.toFixed(2)} ${flagTop.toFixed(2)} L ${flagRight.toFixed(2)} ${flagTopR.toFixed(
          2
        )} L ${flagRight.toFixed(2)} ${flagBottomR.toFixed(2)} L ${flagLeft.toFixed(2)} ${flagBottom.toFixed(2)} Z"
          stroke="rgba(255,255,255,0.70)" stroke-width="2.2" fill="rgba(255,255,255,0.04)"/>
      `;
      break;
    }
    case "pennant": {
      const poleX = x0 + innerW * 0.28;
      const poleTop = mapY(0.24);
      const poleBottom = mapY(0.70);
      const leftX = x0 + innerW * 0.38;
      const rightX = x0 + innerW * 0.78;
      const topY = mapY(0.36);
      const bottomY = mapY(0.58);
      glyph = `
        <path d="M ${poleX.toFixed(2)} ${poleTop.toFixed(2)} L ${poleX.toFixed(2)} ${poleBottom.toFixed(2)}"
          stroke="${accent}" stroke-width="2.8" fill="none" stroke-linecap="round"/>
        <path d="M ${leftX.toFixed(2)} ${bottomY.toFixed(2)} L ${(x0 + innerW * 0.58).toFixed(2)} ${topY.toFixed(2)} L ${rightX.toFixed(2)} ${bottomY.toFixed(2)} Z"
          stroke="rgba(255,255,255,0.72)" stroke-width="2.2" fill="rgba(255,255,255,0.03)" />
      `;
      break;
    }
    case "head_and_shoulders_top": {
      const leftX = x0 + innerW * 0.22;
      const midX = x0 + innerW * 0.50;
      const rightX = x0 + innerW * 0.78;
      const necklineY = mapY(0.60);
      const shoulderY = mapY(0.44);
      const headY = mapY(0.30);
      glyph = `
        <path d="M ${leftX.toFixed(2)} ${necklineY.toFixed(2)} L ${midX.toFixed(2)} ${necklineY.toFixed(2)}"
          stroke="rgba(255,255,255,0.22)" stroke-width="2.0" fill="none" stroke-linecap="round"/>
        <path d="M ${leftX.toFixed(2)} ${necklineY.toFixed(2)} L ${(x0 + innerW * 0.33).toFixed(2)} ${shoulderY.toFixed(2)} L ${midX.toFixed(
          2
        )} ${headY.toFixed(2)} L ${(x0 + innerW * 0.67).toFixed(2)} ${shoulderY.toFixed(2)} L ${rightX.toFixed(2)} ${necklineY.toFixed(2)}"
          stroke="${accent}" stroke-width="2.6" fill="none" stroke-linecap="round"/>
      `;
      break;
    }
    case "inverted_head_and_shoulders": {
      const leftX = x0 + innerW * 0.22;
      const midX = x0 + innerW * 0.50;
      const rightX = x0 + innerW * 0.78;
      const necklineY = mapY(0.40);
      const shoulderY = mapY(0.56);
      const headY = mapY(0.70);
      glyph = `
        <path d="M ${leftX.toFixed(2)} ${necklineY.toFixed(2)} L ${rightX.toFixed(2)} ${necklineY.toFixed(2)}"
          stroke="rgba(255,255,255,0.22)" stroke-width="2.0" fill="none" stroke-linecap="round"/>
        <path d="M ${leftX.toFixed(2)} ${necklineY.toFixed(2)} L ${(x0 + innerW * 0.33).toFixed(2)} ${shoulderY.toFixed(2)} L ${midX.toFixed(
          2
        )} ${headY.toFixed(2)} L ${(x0 + innerW * 0.67).toFixed(2)} ${shoulderY.toFixed(2)} L ${rightX.toFixed(2)} ${necklineY.toFixed(2)}"
          stroke="${accent}" stroke-width="2.6" fill="none" stroke-linecap="round"/>
      `;
      break;
    }
    case "double_top":
    case "double_bottom": {
      const isBottom = id === "double_bottom";
      const leftX = x0 + innerW * 0.22;
      const rightX = x0 + innerW * 0.78;
      const peakOrTroughY = isBottom ? mapY(0.68) : mapY(0.32);
      const centerY = isBottom ? mapY(0.52) : mapY(0.46);
      glyph = `
        <path d="M ${leftX.toFixed(2)} ${centerY.toFixed(2)} Q ${(x0 + innerW * 0.33).toFixed(2)} ${peakOrTroughY.toFixed(
          2
        )} ${(x0 + innerW * 0.50).toFixed(2)} ${centerY.toFixed(2)} Q ${(x0 + innerW * 0.67).toFixed(2)} ${peakOrTroughY.toFixed(
          2
        )} ${rightX.toFixed(2)} ${centerY.toFixed(2)}"
          stroke="${accent}" stroke-width="2.6" fill="none" stroke-linecap="round"/>
        <path d="M ${leftX.toFixed(2)} ${centerY.toFixed(2)} L ${rightX.toFixed(2)} ${centerY.toFixed(2)}"
          stroke="rgba(255,255,255,0.22)" stroke-width="2.0" fill="none" stroke-linecap="round"/>
      `;
      break;
    }
    case "broadening_triangle_wedge": {
      const leftX = x0 + innerW * 0.22;
      const rightX = x0 + innerW * 0.78;
      const apexX = x0 + innerW * 0.50;
      const topLeftY = mapY(0.38);
      const topRightY = mapY(0.40);
      const bottomLeftY = mapY(0.66);
      const bottomRightY = mapY(0.62);
      glyph = `
        <path d="M ${leftX.toFixed(2)} ${topLeftY.toFixed(2)} L ${apexX.toFixed(2)} ${bottomLeftY.toFixed(2)}"
          stroke="${accent}" stroke-width="2.6" fill="none" stroke-linecap="round"/>
        <path d="M ${rightX.toFixed(2)} ${topRightY.toFixed(2)} L ${apexX.toFixed(2)} ${bottomRightY.toFixed(2)}"
          stroke="rgba(255,255,255,0.72)" stroke-width="2.2" fill="none" stroke-linecap="round"/>
        <path d="M ${(x0 + innerW * 0.35).toFixed(2)} ${mapY(0.52).toFixed(2)} L ${(
        x0 +
        innerW * 0.65
      ).toFixed(2)} ${mapY(0.52).toFixed(2)}" stroke="rgba(255,255,255,0.18)" stroke-width="2" stroke-linecap="round"/>
      `;
      break;
    }
    case "descending_broadening_wedge": {
      const leftX = x0 + innerW * 0.20;
      const rightX = x0 + innerW * 0.80;
      const topY = mapY(0.28);
      const bottomLeftY = mapY(0.78);
      const bottomRightY = mapY(0.70);
      glyph = `
        <path d="M ${leftX.toFixed(2)} ${topY.toFixed(2)} L ${rightX.toFixed(2)} ${bottomRightY.toFixed(2)}"
          stroke="${accent}" stroke-width="2.6" fill="none" stroke-linecap="round"/>
        <path d="M ${rightX.toFixed(2)} ${topY.toFixed(2)} L ${leftX.toFixed(2)} ${bottomLeftY.toFixed(2)}"
          stroke="rgba(255,255,255,0.72)" stroke-width="2.2" fill="none" stroke-linecap="round"/>
      `;
      break;
    }
    case "right_angled_broadening_wedge": {
      const cornerX = x0 + innerW * 0.50;
      const cornerY = mapY(0.52);
      glyph = `
        <path d="M ${(cornerX - innerW * 0.18).toFixed(2)} ${mapY(0.66).toFixed(2)} L ${cornerX.toFixed(
        2
      )} ${cornerY.toFixed(2)}"
          stroke="${accent}" stroke-width="2.6" fill="none" stroke-linecap="round"/>
        <path d="M ${cornerX.toFixed(2)} ${cornerY.toFixed(2)} L ${(cornerX + innerW * 0.22).toFixed(2)} ${mapY(0.32).toFixed(
        2
      )}"
          stroke="rgba(255,255,255,0.72)" stroke-width="2.2" fill="none" stroke-linecap="round"/>
        <path d="M ${cornerX.toFixed(2)} ${mapY(0.66).toFixed(2)} L ${cornerX.toFixed(2)} ${cornerY.toFixed(2)}"
          stroke="rgba(255,255,255,0.16)" stroke-width="2" fill="none" stroke-linecap="round"/>
      `;
      break;
    }
    case "three_drive_pattern": {
      const leftX = x0 + innerW * 0.20;
      const rightX = x0 + innerW * 0.84;
      const aTop = mapY(0.38);
      const bBottom = mapY(0.56);
      const cTop = mapY(0.32);
      const dBottom = mapY(0.60);
      const eTop = mapY(0.44);
      glyph = `
        <path d="M ${leftX.toFixed(2)} ${bBottom.toFixed(2)}
                 L ${(x0 + innerW * 0.30).toFixed(2)} ${aTop.toFixed(2)}
                 L ${(x0 + innerW * 0.42).toFixed(2)} ${bBottom.toFixed(2)}
                 L ${(x0 + innerW * 0.54).toFixed(2)} ${cTop.toFixed(2)}
                 L ${(x0 + innerW * 0.66).toFixed(2)} ${dBottom.toFixed(2)}
                 L ${(x0 + innerW * 0.78).toFixed(2)} ${eTop.toFixed(2)}
                 L ${rightX.toFixed(2)} ${bBottom.toFixed(2)}"
          stroke="${accent}" stroke-width="2.6" fill="none" stroke-linecap="round"/>
        <path d="M ${leftX.toFixed(2)} ${bBottom.toFixed(2)} L ${rightX.toFixed(2)} ${bBottom.toFixed(2)}"
          stroke="rgba(255,255,255,0.18)" stroke-width="2" fill="none" stroke-linecap="round"/>
      `;
      break;
    }
    case "quad_theory": {
      const centerX = x0 + innerW * 0.50;
      const centerY = mapY(0.50);
      const topY = mapY(0.28);
      const bottomY = mapY(0.72);
      const leftX = x0 + innerW * 0.22;
      const rightX = x0 + innerW * 0.86;
      glyph = `
        <path d="M ${centerX.toFixed(2)} ${topY.toFixed(2)} L ${rightX.toFixed(2)} ${centerY.toFixed(2)} L ${centerX.toFixed(2)} ${bottomY.toFixed(
        2
      )} L ${leftX.toFixed(2)} ${centerY.toFixed(2)} Z"
          stroke="${accent}" stroke-width="2.6" fill="none" stroke-linecap="round"/>
        <path d="M ${leftX.toFixed(2)} ${centerY.toFixed(2)} L ${rightX.toFixed(2)} ${centerY.toFixed(2)}"
          stroke="rgba(255,255,255,0.18)" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="M ${centerX.toFixed(2)} ${topY.toFixed(2)} L ${centerX.toFixed(2)} ${bottomY.toFixed(2)}"
          stroke="rgba(255,255,255,0.18)" stroke-width="2" fill="none" stroke-linecap="round"/>
        <circle cx="${centerX.toFixed(2)}" cy="${centerY.toFixed(2)}" r="4.5" fill="${accent}" opacity="0.75"/>
      `;
      break;
    }

    case "triple_bottom": {
      // Three V-troughs under a neckline.
      const leftX = x0 + innerW * 0.18;
      const mid1X = x0 + innerW * 0.38;
      const mid2X = x0 + innerW * 0.58;
      const rightX = x0 + innerW * 0.80;
      const necklineY = mapY(0.42);
      const troughY = mapY(0.70);
      const shoulderY = mapY(0.52);

      glyph = `
        <path d="M ${leftX.toFixed(2)} ${necklineY.toFixed(2)}
                 L ${(mid1X).toFixed(2)} ${shoulderY.toFixed(2)}
                 L ${(mid1X).toFixed(2)} ${troughY.toFixed(2)}
                 L ${(mid2X).toFixed(2)} ${troughY.toFixed(2)}
                 L ${(mid2X).toFixed(2)} ${shoulderY.toFixed(2)}
                 L ${rightX.toFixed(2)} ${necklineY.toFixed(2)}"
          stroke="${accent}" stroke-width="2.6" fill="none" stroke-linecap="round"/>

        <path d="M ${leftX.toFixed(2)} ${necklineY.toFixed(2)} L ${rightX.toFixed(2)} ${necklineY.toFixed(
          2
        )}"
          stroke="rgba(255,255,255,0.20)" stroke-width="2" fill="none" stroke-linecap="round"/>

        <path d="M ${(mid1X).toFixed(2)} ${shoulderY.toFixed(2)} L ${(mid1X).toFixed(2)} ${troughY.toFixed(
          2
        )}" stroke="rgba(255,255,255,0.26)" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="M ${(mid2X).toFixed(2)} ${shoulderY.toFixed(2)} L ${(mid2X).toFixed(2)} ${troughY.toFixed(
          2
        )}" stroke="rgba(255,255,255,0.26)" stroke-width="2" fill="none" stroke-linecap="round"/>
      `;
      break;
    }

    case "rounding_bottom": {
      // Rounding bottom: a broad U-shaped curve with a bounce up.
      const leftX = x0 + innerW * 0.22;
      const apexX = x0 + innerW * 0.50;
      const rightX = x0 + innerW * 0.80;
      const necklineY = mapY(0.42);
      const bottomY = mapY(0.72);

      glyph = `
        <path d="M ${leftX.toFixed(2)} ${necklineY.toFixed(2)}
                 C ${(leftX + innerW * 0.10).toFixed(2)} ${bottomY.toFixed(2)} ${(apexX - innerW * 0.10).toFixed(2)} ${bottomY.toFixed(
        2
      )} ${apexX.toFixed(2)} ${bottomY.toFixed(2)}
                 C ${(apexX + innerW * 0.10).toFixed(2)} ${bottomY.toFixed(2)} ${(rightX - innerW * 0.10).toFixed(2)} ${bottomY.toFixed(
        2
      )} ${rightX.toFixed(2)} ${necklineY.toFixed(2)}"
          stroke="${accent}" stroke-width="2.8" fill="none" stroke-linecap="round"/>

        <path d="M ${leftX.toFixed(2)} ${necklineY.toFixed(2)} L ${rightX.toFixed(2)} ${necklineY.toFixed(
          2
        )}"
          stroke="rgba(255,255,255,0.20)" stroke-width="2" fill="none" stroke-linecap="round"/>

        <path d="M ${apexX.toFixed(2)} ${bottomY.toFixed(2)} L ${apexX.toFixed(2)} ${bottomY.toFixed(
        2
      )}" stroke="rgba(255,255,255,0.22)" stroke-width="2" fill="none" stroke-linecap="round"/>
      `;
      break;
    }

    // Candlestick patterns
    case "doji": {
      const cx = x0 + innerW * 0.52;
      const wickTop = mapY(0.82);
      const wickBottom = mapY(0.18);
      const bodyTop = mapY(0.54);
      const bodyBottom = mapY(0.48);
      glyph = `
        <path d="M ${cx.toFixed(2)} ${wickTop.toFixed(2)} L ${cx.toFixed(2)} ${wickBottom.toFixed(2)}" stroke="rgba(255,255,255,0.30)" stroke-width="2.2" stroke-linecap="round"/>
        <rect x="${(cx - innerW * 0.06).toFixed(2)}" y="${Math.min(bodyTop, bodyBottom).toFixed(2)}" width="${(
        innerW * 0.12
      ).toFixed(2)}" height="${Math.abs(bodyBottom - bodyTop).toFixed(2)}" rx="6" fill="${accent}" opacity="0.35" stroke="rgba(255,255,255,0.24)"/>
      `;
      break;
    }
    case "hammer": {
      const cx = x0 + innerW * 0.52;
      const wickTop = mapY(0.72);
      const bodyTop = mapY(0.60);
      const bodyBottom = mapY(0.42);
      const wickBottom = mapY(0.14);
      glyph = `
        <path d="M ${cx.toFixed(2)} ${wickTop.toFixed(2)} L ${cx.toFixed(2)} ${wickBottom.toFixed(2)}" stroke="rgba(255,255,255,0.30)" stroke-width="2.2" stroke-linecap="round"/>
        <rect x="${(cx - innerW * 0.06).toFixed(2)}" y="${Math.min(bodyTop, bodyBottom).toFixed(2)}" width="${(
        innerW * 0.12
      ).toFixed(2)}" height="${Math.abs(bodyBottom - bodyTop).toFixed(2)}" rx="6" fill="${accent}" opacity="0.70" stroke="rgba(255,255,255,0.22)"/>
      `;
      break;
    }
    case "hanging_man": {
      const cx = x0 + innerW * 0.52;
      const wickTop = mapY(0.62);
      const bodyTop = mapY(0.48);
      const bodyBottom = mapY(0.26);
      const wickBottom = mapY(0.14);
      glyph = `
        <path d="M ${cx.toFixed(2)} ${wickTop.toFixed(2)} L ${cx.toFixed(2)} ${wickBottom.toFixed(2)}" stroke="rgba(255,255,255,0.30)" stroke-width="2.2" stroke-linecap="round"/>
        <rect x="${(cx - innerW * 0.06).toFixed(2)}" y="${Math.min(bodyTop, bodyBottom).toFixed(2)}" width="${(
        innerW * 0.12
      ).toFixed(2)}" height="${Math.abs(bodyBottom - bodyTop).toFixed(2)}" rx="6" fill="${accent}" opacity="0.55" stroke="rgba(255,255,255,0.22)"/>
      `;
      break;
    }
    case "shooting_star": {
      const cx = x0 + innerW * 0.52;
      const wickTop = mapY(0.88);
      const bodyTop = mapY(0.30);
      const bodyBottom = mapY(0.12);
      const wickBottom = mapY(0.08);
      glyph = `
        <path d="M ${cx.toFixed(2)} ${wickTop.toFixed(2)} L ${cx.toFixed(2)} ${wickBottom.toFixed(2)}" stroke="rgba(255,255,255,0.30)" stroke-width="2.2" stroke-linecap="round"/>
        <rect x="${(cx - innerW * 0.06).toFixed(2)}" y="${Math.min(bodyTop, bodyBottom).toFixed(2)}" width="${(
        innerW * 0.12
      ).toFixed(2)}" height="${Math.abs(bodyBottom - bodyTop).toFixed(2)}" rx="6" fill="${accent}" opacity="0.55" stroke="rgba(255,255,255,0.22)"/>
      `;
      break;
    }

    case "bullish_engulfing": {
      const leftC = x0 + innerW * 0.38;
      const rightC = x0 + innerW * 0.62;
      const bull = "rgba(16,185,129,0.78)";
      const bear = "rgba(239,68,68,0.72)";
      const wickStroke = "rgba(255,255,255,0.28)";

      const body1Top = mapY(0.55);
      const body1Bottom = mapY(0.40);
      const body2Top = mapY(0.70);
      const body2Bottom = mapY(0.28);

      const wickTop1 = mapY(0.78);
      const wickBot1 = mapY(0.22);
      const wickTop2 = mapY(0.82);
      const wickBot2 = mapY(0.18);

      glyph = `
        <path d="M ${leftC.toFixed(2)} ${wickTop1.toFixed(2)} L ${leftC.toFixed(2)} ${wickBot1.toFixed(2)}" stroke="${wickStroke}" stroke-width="2.2" stroke-linecap="round"/>
        <rect x="${(leftC - innerW * 0.06).toFixed(2)}" y="${Math.min(body1Top, body1Bottom).toFixed(2)}" width="${(
        innerW * 0.12
      ).toFixed(2)}" height="${Math.abs(body1Bottom - body1Top).toFixed(2)}" rx="6" fill="${bear}" opacity="0.85" stroke="rgba(255,255,255,0.18)"/>

        <path d="M ${rightC.toFixed(2)} ${wickTop2.toFixed(2)} L ${rightC.toFixed(2)} ${wickBot2.toFixed(2)}" stroke="${wickStroke}" stroke-width="2.2" stroke-linecap="round"/>
        <rect x="${(rightC - innerW * 0.08).toFixed(2)}" y="${Math.min(body2Top, body2Bottom).toFixed(2)}" width="${(
        innerW * 0.16
      ).toFixed(2)}" height="${Math.abs(body2Bottom - body2Top).toFixed(2)}" rx="7" fill="${bull}" opacity="0.85" stroke="rgba(255,255,255,0.18)"/>
      `;
      break;
    }
    case "bearish_engulfing": {
      const leftC = x0 + innerW * 0.38;
      const rightC = x0 + innerW * 0.62;
      const bull = "rgba(16,185,129,0.72)";
      const bear = "rgba(239,68,68,0.78)";
      const wickStroke = "rgba(255,255,255,0.28)";

      const body1Top = mapY(0.55);
      const body1Bottom = mapY(0.40);
      const body2Top = mapY(0.70);
      const body2Bottom = mapY(0.28);

      const wickTop1 = mapY(0.78);
      const wickBot1 = mapY(0.22);
      const wickTop2 = mapY(0.82);
      const wickBot2 = mapY(0.18);

      glyph = `
        <path d="M ${leftC.toFixed(2)} ${wickTop1.toFixed(2)} L ${leftC.toFixed(2)} ${wickBot1.toFixed(2)}" stroke="${wickStroke}" stroke-width="2.2" stroke-linecap="round"/>
        <rect x="${(leftC - innerW * 0.06).toFixed(2)}" y="${Math.min(body1Top, body1Bottom).toFixed(2)}" width="${(
        innerW * 0.12
      ).toFixed(2)}" height="${Math.abs(body1Bottom - body1Top).toFixed(2)}" rx="6" fill="${bull}" opacity="0.85" stroke="rgba(255,255,255,0.18)"/>

        <path d="M ${rightC.toFixed(2)} ${wickTop2.toFixed(2)} L ${rightC.toFixed(2)} ${wickBot2.toFixed(2)}" stroke="${wickStroke}" stroke-width="2.2" stroke-linecap="round"/>
        <rect x="${(rightC - innerW * 0.08).toFixed(2)}" y="${Math.min(body2Top, body2Bottom).toFixed(2)}" width="${(
        innerW * 0.16
      ).toFixed(2)}" height="${Math.abs(body2Bottom - body2Top).toFixed(2)}" rx="7" fill="${bear}" opacity="0.85" stroke="rgba(255,255,255,0.18)"/>
      `;
      break;
    }

    case "morning_star": {
      const leftC = x0 + innerW * 0.32;
      const midC = x0 + innerW * 0.50;
      const rightC = x0 + innerW * 0.68;
      const bull = "rgba(16,185,129,0.78)";
      const bear = "rgba(239,68,68,0.72)";
      const wickStroke = "rgba(255,255,255,0.26)";

      const c1Top = mapY(0.72);
      const c1Bottom = mapY(0.48);
      const c2Top = mapY(0.55);
      const c2Bottom = mapY(0.48);
      const c3Top = mapY(0.60);
      const c3Bottom = mapY(0.26);

      glyph = `
        <path d="M ${leftC.toFixed(2)} ${mapY(0.84).toFixed(2)} L ${leftC.toFixed(2)} ${mapY(0.34).toFixed(2)}" stroke="${wickStroke}" stroke-width="2.2" stroke-linecap="round"/>
        <rect x="${(leftC - innerW * 0.06).toFixed(2)}" y="${Math.min(c1Top, c1Bottom).toFixed(2)}" width="${(
        innerW * 0.12
      ).toFixed(2)}" height="${Math.abs(c1Bottom - c1Top).toFixed(2)}" rx="6" fill="${bear}" opacity="0.85"/>

        <path d="M ${midC.toFixed(2)} ${mapY(0.70).toFixed(2)} L ${midC.toFixed(2)} ${mapY(0.44).toFixed(2)}" stroke="${wickStroke}" stroke-width="2.0" stroke-linecap="round"/>
        <rect x="${(midC - innerW * 0.03).toFixed(2)}" y="${Math.min(c2Top, c2Bottom).toFixed(2)}" width="${(
        innerW * 0.06
      ).toFixed(2)}" height="${Math.abs(c2Bottom - c2Top).toFixed(2)}" rx="5" fill="${accent}" opacity="0.35"/>

        <path d="M ${rightC.toFixed(2)} ${mapY(0.70).toFixed(2)} L ${rightC.toFixed(2)} ${mapY(0.18).toFixed(2)}" stroke="${wickStroke}" stroke-width="2.2" stroke-linecap="round"/>
        <rect x="${(rightC - innerW * 0.06).toFixed(2)}" y="${Math.min(c3Top, c3Bottom).toFixed(2)}" width="${(
        innerW * 0.12
      ).toFixed(2)}" height="${Math.abs(c3Bottom - c3Top).toFixed(2)}" rx="6" fill="${bull}" opacity="0.90"/>
      `;
      break;
    }

    case "evening_star": {
      const leftC = x0 + innerW * 0.32;
      const midC = x0 + innerW * 0.50;
      const rightC = x0 + innerW * 0.68;
      const bull = "rgba(16,185,129,0.72)";
      const bear = "rgba(239,68,68,0.80)";
      const wickStroke = "rgba(255,255,255,0.26)";

      const c1Top = mapY(0.66);
      const c1Bottom = mapY(0.44);
      const c2Top = mapY(0.52);
      const c2Bottom = mapY(0.46);
      const c3Top = mapY(0.44);
      const c3Bottom = mapY(0.20);

      glyph = `
        <path d="M ${leftC.toFixed(2)} ${mapY(0.82).toFixed(2)} L ${leftC.toFixed(2)} ${mapY(0.36).toFixed(2)}" stroke="${wickStroke}" stroke-width="2.2" stroke-linecap="round"/>
        <rect x="${(leftC - innerW * 0.06).toFixed(2)}" y="${Math.min(c1Top, c1Bottom).toFixed(2)}" width="${(
        innerW * 0.12
      ).toFixed(2)}" height="${Math.abs(c1Bottom - c1Top).toFixed(2)}" rx="6" fill="${bull}" opacity="0.85"/>

        <path d="M ${midC.toFixed(2)} ${mapY(0.64).toFixed(2)} L ${midC.toFixed(2)} ${mapY(0.42).toFixed(2)}" stroke="${wickStroke}" stroke-width="2.0" stroke-linecap="round"/>
        <rect x="${(midC - innerW * 0.03).toFixed(2)}" y="${Math.min(c2Top, c2Bottom).toFixed(2)}" width="${(
        innerW * 0.06
      ).toFixed(2)}" height="${Math.abs(c2Bottom - c2Top).toFixed(2)}" rx="5" fill="${accent}" opacity="0.35"/>

        <path d="M ${rightC.toFixed(2)} ${mapY(0.60).toFixed(2)} L ${rightC.toFixed(2)} ${mapY(0.10).toFixed(2)}" stroke="${wickStroke}" stroke-width="2.2" stroke-linecap="round"/>
        <rect x="${(rightC - innerW * 0.06).toFixed(2)}" y="${Math.min(c3Top, c3Bottom).toFixed(2)}" width="${(
        innerW * 0.12
      ).toFixed(2)}" height="${Math.abs(c3Bottom - c3Top).toFixed(2)}" rx="6" fill="${bear}" opacity="0.90"/>
      `;
      break;
    }

    case "bullish_marubozu": {
      const cx = x0 + innerW * 0.52;
      const left = cx - innerW * 0.18;
      const right = cx + innerW * 0.18;
      const bodyTop = mapY(0.78);
      const bodyBottom = mapY(0.22);
      glyph = `
        <rect x="${left.toFixed(2)}" y="${Math.min(bodyTop, bodyBottom).toFixed(2)}" width="${(right - left).toFixed(
        2
      )}" height="${Math.abs(bodyBottom - bodyTop).toFixed(2)}" rx="10" fill="rgba(16,185,129,0.85)" stroke="rgba(255,255,255,0.20)"/>
        <path d="M ${cx.toFixed(2)} ${mapY(0.82).toFixed(2)} L ${cx.toFixed(2)} ${mapY(0.76).toFixed(
        2
      )}" stroke="rgba(255,255,255,0.26)" stroke-width="2" stroke-linecap="round"/>
        <path d="M ${cx.toFixed(2)} ${mapY(0.24).toFixed(2)} L ${cx.toFixed(2)} ${mapY(0.18).toFixed(
        2
      )}" stroke="rgba(255,255,255,0.26)" stroke-width="2" stroke-linecap="round"/>
      `;
      break;
    }

    case "bearish_marubozu": {
      const cx = x0 + innerW * 0.52;
      const left = cx - innerW * 0.18;
      const right = cx + innerW * 0.18;
      const bodyTop = mapY(0.78);
      const bodyBottom = mapY(0.22);
      glyph = `
        <rect x="${left.toFixed(2)}" y="${Math.min(bodyTop, bodyBottom).toFixed(2)}" width="${(right - left).toFixed(
        2
      )}" height="${Math.abs(bodyBottom - bodyTop).toFixed(2)}" rx="10" fill="rgba(239,68,68,0.85)" stroke="rgba(255,255,255,0.20)"/>
        <path d="M ${cx.toFixed(2)} ${mapY(0.82).toFixed(2)} L ${cx.toFixed(2)} ${mapY(0.76).toFixed(
        2
      )}" stroke="rgba(255,255,255,0.26)" stroke-width="2" stroke-linecap="round"/>
        <path d="M ${cx.toFixed(2)} ${mapY(0.24).toFixed(2)} L ${cx.toFixed(2)} ${mapY(0.18).toFixed(
        2
      )}" stroke="rgba(255,255,255,0.26)" stroke-width="2" stroke-linecap="round"/>
      `;
      break;
    }

    case "adx": {
      // ADX: two lines with a central baseline + a strength cue.
      const p1 = [
        [0.06, 0.35],
        [0.22, 0.52],
        [0.38, 0.44],
        [0.54, 0.62],
        [0.70, 0.48],
        [0.86, 0.58],
        [0.95, 0.52],
      ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);
      const p2 = [
        [0.06, 0.42],
        [0.22, 0.38],
        [0.38, 0.54],
        [0.54, 0.46],
        [0.70, 0.58],
        [0.86, 0.50],
        [0.95, 0.56],
      ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);
      glyph = `
        <path d="${pointsToPath(p2)}" ${accentLine}/>
        <path d="${pointsToPath(p1)}" stroke="rgba(255,255,255,0.70)" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="M ${x0} ${mapY(0.5)} L ${x1} ${mapY(0.5)}" stroke="rgba(255,255,255,0.25)" stroke-width="1"/>
        <rect x="${(x0 + innerW * 0.70).toFixed(2)}" y="${(y0 + innerH * 0.18).toFixed(2)}" width="${(innerW * 0.18).toFixed(
          2
        )}" height="${(innerH * 0.35).toFixed(2)}" rx="10" fill="${accent}" opacity="0.14"/>
      `;
      break;
    }
    case "atr":
    case "atr_pct": {
      // ATR: volatility bars (range).
      const vals = [0.28, 0.40, 0.33, 0.55, 0.42, 0.62, 0.48, 0.58, 0.44];
      const barW = innerW / vals.length - 4;
      glyph = `
        <g>
          ${vals
            .map((v, i) => {
              const cx = x0 + (i + 0.5) * (innerW / vals.length);
              const barH = v * innerH * 0.82;
              const top = y1 - barH;
              return `<rect x="${(cx - barW / 2).toFixed(2)}" y="${top.toFixed(2)}" width="${barW.toFixed(
                2
              )}" height="${barH.toFixed(2)}" rx="3" fill="${accent}" opacity="${
                id === "atr_pct" ? 0.28 : 0.32
              }"/>`;
            })
            .join("\n")}
        </g>
      `;
      break;
    }
    case "vortex": {
      // Vortex: two lines and a stronger baseline band.
      const a = [
        [0.06, 0.55],
        [0.22, 0.45],
        [0.38, 0.60],
        [0.54, 0.42],
        [0.70, 0.58],
        [0.86, 0.46],
        [0.95, 0.54],
      ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);
      const b = [
        [0.06, 0.42],
        [0.22, 0.56],
        [0.38, 0.48],
        [0.54, 0.62],
        [0.70, 0.50],
        [0.86, 0.64],
        [0.95, 0.52],
      ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);
      glyph = `
        <rect x="${(x0 + innerW * 0.12).toFixed(2)}" y="${(y0 + innerH * 0.14).toFixed(2)}" width="${(innerW * 0.76).toFixed(
          2
        )}" height="${(innerH * 0.08).toFixed(2)}" rx="8" fill="${accent}" opacity="0.14"/>
        <path d="${pointsToPath(a)}" stroke="rgba(255,255,255,0.72)" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="${pointsToPath(b)}" ${accentLine}/>
      `;
      break;
    }
    case "ema_ribbon": {
      // Ribbon: stacked EMA lines.
      const levels = [
        0.66, 0.60, 0.54, 0.48, 0.42,
      ];
      glyph = `
        ${levels
          .map((t, i) => {
            const pts = [
              [0.06, t - 0.06],
              [0.20, t + 0.04],
              [0.36, t - 0.02],
              [0.52, t + 0.03],
              [0.68, t - 0.02],
              [0.84, t + 0.02],
              [0.95, t - 0.01],
            ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);
            const opacity = (0.90 - i * 0.12).toFixed(2);
            return `<path d="${pointsToPath(pts)}" stroke="${accent}" stroke-width="${(2 - i * 0.15).toFixed(
              2
            )}" fill="none" stroke-linecap="round" opacity="${opacity}"/>`;
          })
          .join("")}
      `;
      break;
    }
    case "psar": {
      // Parabolic SAR: dot trail above/below.
      const dots = [
        [0.10, 0.40],
        [0.20, 0.45],
        [0.32, 0.38],
        [0.44, 0.52],
        [0.56, 0.46],
        [0.68, 0.56],
        [0.80, 0.48],
        [0.92, 0.58],
      ];
      glyph = `
        <path d="M ${x0} ${mapY(0.52)} L ${x1} ${mapY(0.52)}" stroke="rgba(255,255,255,0.14)" stroke-width="1"/>
        ${dots
          .map(([tx, ty], i) => {
            const cx = mapX(tx);
            const cy = mapY(ty);
            const r = (3.2 + (i % 2) * 0.7).toFixed(2);
            return `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r}" fill="${accent}" opacity="0.88"/>`;
          })
          .join("")}
      `;
      break;
    }
    case "keltner":
    case "donchian": {
      // Channels: upper/lower boundaries + middle line.
      const upperT = 0.72;
      const lowerT = 0.30;
      glyph = `
        <path d="M ${x0} ${mapY(upperT)} L ${x1} ${mapY(upperT + 0.02)}" stroke="rgba(255,255,255,0.65)" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="M ${x0} ${mapY(lowerT)} L ${x1} ${mapY(lowerT - 0.02)}" stroke="rgba(255,255,255,0.30)" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="M ${x0} ${mapY(0.52)} L ${x1} ${mapY(0.52)}" ${accentSoftLine}/>
        ${id === "donchian" ? `<rect x="${(x0 + innerW * 0.58).toFixed(2)}" y="${(y0 + innerH * 0.20).toFixed(2)}" width="${(innerW * 0.24).toFixed(2)}" height="${(innerH * 0.6).toFixed(2)}" rx="10" fill="${accent}" opacity="0.10"/>` : ``}
      `;
      break;
    }
    case "cci": {
      // CCI: oscillator with -100/0/100 zones.
      const pts = [
        [0.06, 0.54],
        [0.20, 0.68],
        [0.35, 0.44],
        [0.50, 0.62],
        [0.65, 0.34],
        [0.80, 0.58],
        [0.95, 0.48],
      ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);
      glyph = `
        <path d="${pointsToPath(pts)}" ${accentLine}/>
        <path d="M ${x0} ${mapY(0.20)} L ${x1} ${mapY(0.20)}" stroke="rgba(255,255,255,0.16)" stroke-width="1"/>
        <path d="M ${x0} ${mapY(0.50)} L ${x1} ${mapY(0.50)}" stroke="rgba(255,255,255,0.24)" stroke-width="1"/>
        <path d="M ${x0} ${mapY(0.80)} L ${x1} ${mapY(0.80)}" stroke="rgba(255,255,255,0.18)" stroke-width="1"/>
      `;
      break;
    }
    case "williams_r": {
      // Williams %R: oscillator with 0 / -50 / -100 feel (three lines).
      const pts = [
        [0.06, 0.62],
        [0.18, 0.48],
        [0.32, 0.58],
        [0.46, 0.40],
        [0.60, 0.54],
        [0.74, 0.42],
        [0.88, 0.56],
        [0.95, 0.50],
      ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);
      glyph = `
        <path d="${pointsToPath(pts)}" ${accentLine}/>
        <path d="M ${x0} ${mapY(0.20)} L ${x1} ${mapY(0.20)}" stroke="rgba(255,255,255,0.16)" stroke-width="1"/>
        <path d="M ${x0} ${mapY(0.50)} L ${x1} ${mapY(0.50)}" stroke="rgba(255,255,255,0.24)" stroke-width="1"/>
        <path d="M ${x0} ${mapY(0.80)} L ${x1} ${mapY(0.80)}" stroke="rgba(255,255,255,0.18)" stroke-width="1"/>
      `;
      break;
    }
    case "obv": {
      // OBV: step line + direction changes.
      const pts = [
        [0.06, 0.46],
        [0.16, 0.52],
        [0.24, 0.44],
        [0.36, 0.58],
        [0.48, 0.48],
        [0.60, 0.62],
        [0.72, 0.50],
        [0.84, 0.66],
        [0.95, 0.56],
      ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);
      glyph = `
        <path d="${pointsToPath(pts)}" ${accentLine}/>
        <path d="M ${x0} ${mapY(0.5)} L ${x1} ${mapY(0.5)}" stroke="rgba(255,255,255,0.20)" stroke-width="1"/>
      `;
      break;
    }
    case "chaikin_osc": {
      // Chaikin Oscillator: two lines around zero.
      const a = [
        [0.06, 0.60],
        [0.24, 0.50],
        [0.42, 0.56],
        [0.60, 0.44],
        [0.78, 0.52],
        [0.95, 0.46],
      ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);
      const b = [
        [0.06, 0.52],
        [0.24, 0.56],
        [0.42, 0.48],
        [0.60, 0.56],
        [0.78, 0.46],
        [0.95, 0.52],
      ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);
      glyph = `
        <path d="${pointsToPath(a)}" ${accentLine}/>
        <path d="${pointsToPath(b)}" stroke="rgba(255,255,255,0.72)" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="M ${x0} ${mapY(0.5)} L ${x1} ${mapY(0.5)}" stroke="rgba(255,255,255,0.24)" stroke-width="1"/>
      `;
      break;
    }
    default: {
      // Keep fallback sparkline but ensure it is still a mini "indicator" visual.
      glyph = `
        <path d="${fallbackPath}" ${accentLine}/>
        <path d="M ${x0} ${mapY(0.5)} L ${x1} ${mapY(0.5)}" stroke="rgba(255,255,255,0.25)" stroke-width="1"/>
        ${id.includes("fib") ? ` <path d="M ${x0} ${mapY(0.8)} L ${x1} ${mapY(0.3)}" stroke="${accent}" stroke-width="2" fill="none" stroke-linecap="round"/>` : ""}
        ${
          useLibraryChart
            ? ""
            : `<circle cx="${(w / 2).toFixed(2)}" cy="${(h - 22).toFixed(2)}" r="${dotR.toFixed(2)}" fill="${accent}" opacity="${dotOpacity.toFixed(2)}"/>`
        }
      `;
      break;
    }
  }

  const caption = useLibraryChart
    ? `<text x="${(w / 2).toFixed(2)}" y="${(h - 8).toFixed(2)}" text-anchor="middle" fill="rgba(255,255,255,0.9)" font-size="12" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif">${captionText}</text>`
    : "";

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      ${header}
      <g>${glyph}</g>
      ${caption}
    </svg>
  `;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function getBuiltinAccentColor(id: string): string {
  const idx = hashString(id) % BUILTIN_ACCENT_COLORS.length;
  return BUILTIN_ACCENT_COLORS[idx];
}

function withLibraryMeta(
  ind: Omit<Indicator, "kind" | "accentColor" | "exampleImage"> &
    {
      kind?: Indicator["kind"];
      accentColor?: string;
      exampleImage?: string;
    }
): Indicator {
  const kind = ind.kind ?? "builtin";
  const accentColor = ind.accentColor ?? (kind === "custom" ? CUSTOM_ACCENT_COLOR : getBuiltinAccentColor(ind.id));
  const exampleImage =
    ind.exampleImage ?? makeIndicatorExampleImageForId(ind.id, ind.abbreviation, accentColor, ind.name);
  const category =
    ind.category ??
    (kind === "custom"
      ? ("Custom" as const)
      : undefined);
  return { ...ind, kind, accentColor, exampleImage, category };
}

// Built-in indicators: merged into the library on load so everyone has a starting set.
// Codes/descriptions are templates; users can still add their own indicators to override behavior.
const BUILTIN_INDICATORS: Array<Omit<Indicator, "createdAt">> = [
  {
    id: "rsi",
    name: "RSI",
    abbreviation: "RSI",
    category: "Momentum",
    description: "Relative Strength Index (momentum oscillator) used to gauge overbought/oversold conditions.",
    code: "// RSI template\n// indicator('RSI', overlay=false)\n// input length = 14\n// plot(rsi(close, length), 'RSI')\n",
  },
  {
    id: "stoch_rsi",
    name: "Stoch RSI",
    abbreviation: "StochRSI",
    category: "Momentum",
    description: "Stochastic oscillator applied to RSI values (often used for mean reversion setups).",
    code: "// StochRSI template\n// plot(stoch(rsi(close, rsiLen), ...), 'StochRSI')\n",
  },
  {
    id: "macd",
    name: "MACD",
    abbreviation: "MACD",
    category: "Momentum",
    description: "Moving Average Convergence Divergence (trend/momentum), based on EMA cross and histogram momentum.",
    code: "// MACD template\n// [macdLine, signalLine, hist] = macd(close, fastLen, slowLen, signalLen)\n",
  },
  {
    id: "bollinger",
    name: "Bollinger Bands",
    abbreviation: "BB",
    category: "Volatility",
    description: "Volatility bands around a moving average (useful for squeeze and band-walk styles).",
    code: "// Bollinger Bands template\n// basis = sma(close, len)\n// dev = stdev(close, len) * mult\n// plot(basis + dev)\n",
  },
  {
    id: "money_flow",
    name: "Money Flow Index (MFI)",
    abbreviation: "MFI",
    category: "Momentum",
    description: "Money Flow Index uses price and volume to measure buying/selling pressure.",
    code: "// MFI template\n// mfi = mfi(high, low, close, volume, len)\n",
  },
  {
    id: "roc",
    name: "Rate of Change (ROC)",
    abbreviation: "ROC",
    category: "Momentum",
    description: "Rate of Change momentum indicator, measuring percentage change over N periods.",
    code: "// ROC template\n// roc = (close - close[rocLen]) / close[rocLen] * 100\n",
  },
  {
    id: "sma",
    name: "Simple Moving Average (SMA)",
    abbreviation: "SMA",
    category: "Trend",
    description: "Simple moving average for trend direction and smoothing.",
    code: "// SMA template\n// plot(sma(close, len), 'SMA')\n",
  },
  {
    id: "ema",
    name: "Exponential Moving Average (EMA)",
    abbreviation: "EMA",
    category: "Trend",
    description: "Exponential moving average for trend direction with higher weight on recent prices.",
    code: "// EMA template\n// plot(ema(close, len), 'EMA')\n",
  },
  {
    id: "ma",
    name: "Moving Averages (MA)",
    abbreviation: "MA",
    category: "Trend",
    description: "Generic moving average helper (use SMA/EMA/other MA types depending on your strategy).",
    code: "// MA template\n",
  },
  {
    id: "fib_levels",
    name: "Fibonacci Levels",
    abbreviation: "Fib",
    category: "Structure",
    description: "Fibonacci retracement levels (supports sweep/reversal style entries).",
    code: "// Fib levels template\n",
  },
  {
    id: "order_block_timeframe",
    name: "Order Block Timeframe",
    abbreviation: "OB-TF",
    category: "Structure",
    description: "Concept indicator: identifies order blocks on a chosen higher timeframe.",
    capturesTimeframes: true,
    code: "// Order Block TF template (conceptual)\n// You may compute OB zones externally and feed them as data.\n",
  },
  {
    id: "elliott_wave",
    name: "Elliott Wave (concept)",
    abbreviation: "EW",
    category: "Structure",
    description: "Concept indicator representing wave counts/labels for wave-tracking strategies.",
    code: "// Elliott Wave template (conceptual)\n",
  },
  {
    id: "choch_bos_timeframe",
    name: "CHoCH + BOS Timeframe",
    abbreviation: "CHoCH/BOS",
    category: "Structure",
    description: "Concept indicator for market structure shifts (CHoCH) and break of structure (BOS) on a selected timeframe.",
    capturesTimeframes: true,
    code: "// CHoCH/BOS template (conceptual)\n",
  },
  {
    id: "sfp",
    name: "SFP (Swing Failure Pattern)",
    abbreviation: "SFP",
    category: "Pattern",
    signalGroup: "TechnicalPattern",
    description: "Concept indicator that tags SFP liquidity grabs for reversal/continuation entries.",
    code: "// SFP template (conceptual)\n",
  },
  {
    id: "fvg",
    name: "FVG (Fair Value Gap)",
    abbreviation: "FVG",
    category: "Pattern",
    signalGroup: "TechnicalPattern",
    description: "Concept indicator for fair value gaps (imbalances) based on candle ranges.",
    code: "// FVG template (conceptual)\n",
  },
  {
    id: "divergence",
    name: "Divergence",
    abbreviation: "Div",
    category: "Pattern",
    signalGroup: "TechnicalPattern",
    description: "Concept indicator for bullish/bearish divergence across oscillators and price.",
    code: "// Divergence template (conceptual)\n",
  },
  {
    id: "harmonics",
    name: "Harmonic Patterns",
    abbreviation: "Harm",
    category: "Pattern",
    signalGroup: "TechnicalPattern",
    description: "Harmonic pattern concept (e.g. Gartley/Bat/Butterfly) and PRZ level mapping.",
    code: "// Harmonic Patterns template (conceptual)\n",
  },
  {
    id: "ascending_triangle",
    name: "Ascending Triangle",
    abbreviation: "AscTri",
    category: "Pattern",
    signalGroup: "TechnicalPattern",
    description: "Ascending triangle pattern: flat resistance with rising support.",
    code: "// Ascending Triangle template (conceptual)\n",
  },
  {
    id: "bearish_symmetric_triangle",
    name: "Bearish Symmetric Triangle",
    abbreviation: "BearSymTri",
    category: "Pattern",
    signalGroup: "TechnicalPattern",
    description: "Symmetric triangle with bearish bias (breakdown emphasis).",
    code: "// Bearish Symmetric Triangle template (conceptual)\n",
  },
  {
    id: "bullish_symmetric_triangle",
    name: "Bullish Symmetric Triangle",
    abbreviation: "BullSymTri",
    category: "Pattern",
    signalGroup: "TechnicalPattern",
    description: "Symmetric triangle with bullish bias (breakout emphasis).",
    code: "// Bullish Symmetric Triangle template (conceptual)\n",
  },
  {
    id: "cup_and_handle",
    name: "Cup & Handle",
    abbreviation: "CupH",
    category: "Pattern",
    signalGroup: "TechnicalPattern",
    description: "Cup and handle pattern: rounded base followed by a consolidation 'handle'.",
    code: "// Cup & Handle template (conceptual)\n",
  },
  {
    id: "descending_triangle",
    name: "Descending Triangle",
    abbreviation: "DescTri",
    category: "Pattern",
    signalGroup: "TechnicalPattern",
    description: "Descending triangle pattern: flat support with falling resistance.",
    code: "// Descending Triangle template (conceptual)\n",
  },
  {
    id: "falling_wedge",
    name: "Falling Wedge",
    abbreviation: "FallW",
    category: "Pattern",
    signalGroup: "TechnicalPattern",
    description: "Falling wedge pattern (converging lines sloping down).",
    code: "// Falling Wedge template (conceptual)\n",
  },
  {
    id: "rising_wedge",
    name: "Rising Wedge",
    abbreviation: "RiseW",
    category: "Pattern",
    signalGroup: "TechnicalPattern",
    description: "Rising wedge pattern (converging lines sloping up).",
    code: "// Rising Wedge template (conceptual)\n",
  },
  {
    id: "flag",
    name: "Flag",
    abbreviation: "Flag",
    category: "Pattern",
    signalGroup: "TechnicalPattern",
    description: "Bullish/bearish flag pattern (pole then consolidation).",
    code: "// Flag template (conceptual)\n",
  },
  {
    id: "pennant",
    name: "Pennant",
    abbreviation: "Penn",
    category: "Pattern",
    signalGroup: "TechnicalPattern",
    description: "Pennant pattern (pole then small converging triangle).",
    code: "// Pennant template (conceptual)\n",
  },
  {
    id: "head_and_shoulders_top",
    name: "Head & Shoulders (Top)",
    abbreviation: "H&S",
    category: "Pattern",
    signalGroup: "TechnicalPattern",
    description: "Head and shoulders top pattern (three peaks with a neckline).",
    code: "// Head & Shoulders Top template (conceptual)\n",
  },
  {
    id: "inverted_head_and_shoulders",
    name: "Head & Shoulders (Bottom)",
    abbreviation: "iH&S",
    category: "Pattern",
    signalGroup: "TechnicalPattern",
    description: "Inverted head and shoulders bottom pattern (three troughs with a neckline).",
    code: "// Inverted Head & Shoulders template (conceptual)\n",
  },
  {
    id: "double_top",
    name: "Double Top",
    abbreviation: "DT",
    category: "Pattern",
    signalGroup: "TechnicalPattern",
    description: "Double top pattern: two peaks with a retreat between them.",
    code: "// Double Top template (conceptual)\n",
  },
  {
    id: "double_bottom",
    name: "Double Bottom",
    abbreviation: "DB",
    category: "Pattern",
    signalGroup: "TechnicalPattern",
    description: "Double bottom pattern: two troughs with a bounce between them.",
    code: "// Double Bottom template (conceptual)\n",
  },
  {
    id: "broadening_triangle_wedge",
    name: "Broadening Triangle / Wedge",
    abbreviation: "BT-W",
    category: "Pattern",
    signalGroup: "TechnicalPattern",
    description: "Broadening triangle / wedge with diverging boundaries.",
    code: "// Broadening Triangle/Wedge template (conceptual)\n",
  },
  {
    id: "descending_broadening_wedge",
    name: "Descending Broadening Wedge",
    abbreviation: "DBW",
    category: "Pattern",
    signalGroup: "TechnicalPattern",
    description: "Descending broadening wedge (diverging lines with a downward bias).",
    code: "// Descending Broadening Wedge template (conceptual)\n",
  },
  {
    id: "right_angled_broadening_wedge",
    name: "Right-Angled Broadening Wedge",
    abbreviation: "RABW",
    category: "Pattern",
    signalGroup: "TechnicalPattern",
    description: "Right-angled broadening wedge (corner + diverging boundaries).",
    code: "// Right-Angled Broadening Wedge template (conceptual)\n",
  },
  {
    id: "three_drive_pattern",
    name: "Three Drive Pattern",
    abbreviation: "3Drive",
    category: "Pattern",
    signalGroup: "TechnicalPattern",
    description: "Three drive pattern (rhythmic push/pull waves).",
    code: "// Three Drive Pattern template (conceptual)\n",
  },
  {
    id: "quad_theory",
    name: "Quad Theory",
    abbreviation: "Quad",
    category: "Pattern",
    signalGroup: "TechnicalPattern",
    description: "Quad theory concept (multi-target / quadrant style projection).",
    code: "// Quad Theory template (conceptual)\n",
  },
  {
    id: "triple_bottom",
    name: "Triple Bottom",
    abbreviation: "3Bot",
    category: "Pattern",
    signalGroup: "TechnicalPattern",
    description: "Triple bottom pattern: three troughs near the same support level, with a neckline breakout.",
    code: "// Triple Bottom template (conceptual)\n",
  },
  {
    id: "rounding_bottom",
    name: "Rounding Bottom",
    abbreviation: "RndBot",
    category: "Pattern",
    signalGroup: "TechnicalPattern",
    description: "Rounding bottom pattern: a gradual U-shaped transition from bearish to bullish momentum.",
    code: "// Rounding Bottom template (conceptual)\n",
  },
  {
    id: "doji",
    name: "Doji",
    abbreviation: "Doji",
    category: "Pattern",
    signalGroup: "Candlestick",
    description: "Doji candle pattern indicating market indecision (open/close near equal).",
    code: "// Doji template (conceptual)\n",
  },
  {
    id: "hammer",
    name: "Hammer",
    abbreviation: "Hammer",
    category: "Pattern",
    signalGroup: "Candlestick",
    description: "Hammer candle pattern suggesting potential reversal after a downtrend (long lower wick).",
    code: "// Hammer template (conceptual)\n",
  },
  {
    id: "hanging_man",
    name: "Hanging Man",
    abbreviation: "HangMan",
    category: "Pattern",
    signalGroup: "Candlestick",
    description: "Hanging man candle pattern indicating potential reversal after an uptrend (similar shape to hammer).",
    code: "// Hanging Man template (conceptual)\n",
  },
  {
    id: "shooting_star",
    name: "Shooting Star",
    abbreviation: "ShootingStar",
    category: "Pattern",
    signalGroup: "Candlestick",
    description: "Shooting star candle pattern suggesting potential reversal after an uptrend (long upper wick).",
    code: "// Shooting Star template (conceptual)\n",
  },
  {
    id: "bullish_engulfing",
    name: "Bullish Engulfing",
    abbreviation: "BullEng",
    category: "Pattern",
    signalGroup: "Candlestick",
    description: "Bullish engulfing candle pattern indicating buyers taking control (bearish body engulfed by bullish body).",
    code: "// Bullish Engulfing template (conceptual)\n",
  },
  {
    id: "bearish_engulfing",
    name: "Bearish Engulfing",
    abbreviation: "BearEng",
    category: "Pattern",
    signalGroup: "Candlestick",
    description: "Bearish engulfing candle pattern indicating sellers taking control (bullish body engulfed by bearish body).",
    code: "// Bearish Engulfing template (conceptual)\n",
  },
  {
    id: "morning_star",
    name: "Morning Star",
    abbreviation: "MorningStar",
    category: "Pattern",
    signalGroup: "Candlestick",
    description: "Morning star candle pattern suggesting trend reversal from bearish to bullish (three-candle structure).",
    code: "// Morning Star template (conceptual)\n",
  },
  {
    id: "evening_star",
    name: "Evening Star",
    abbreviation: "EveningStar",
    category: "Pattern",
    signalGroup: "Candlestick",
    description: "Evening star candle pattern suggesting trend reversal from bullish to bearish (three-candle structure).",
    code: "// Evening Star template (conceptual)\n",
  },
  {
    id: "bullish_marubozu",
    name: "Bullish Marubozu",
    abbreviation: "BullM",
    category: "Pattern",
    signalGroup: "Candlestick",
    description: "Bullish marubozu candle pattern showing strong buying pressure (little/no wick).",
    code: "// Bullish Marubozu template (conceptual)\n",
  },
  {
    id: "bearish_marubozu",
    name: "Bearish Marubozu",
    abbreviation: "BearM",
    category: "Pattern",
    signalGroup: "Candlestick",
    description: "Bearish marubozu candle pattern showing strong selling pressure (little/no wick).",
    code: "// Bearish Marubozu template (conceptual)\n",
  },
  {
    id: "supertrend",
    name: "Supertrend",
    abbreviation: "ST",
    category: "Trend",
    description: "Trend-following indicator using ATR bands to signal direction.",
    code: "// Supertrend template\n",
  },
  {
    id: "ichimoku_cloud",
    name: "Ichimoku Cloud",
    abbreviation: "Ich",
    category: "Trend",
    description: "Ichimoku Kinko Hyo cloud indicator for trend direction using Tenkan/Kijun and Senkou spans.",
    code:
      "// Ichimoku Cloud template\n" +
      "// This is a placeholder template.\n" +
      "// Common inputs:\n" +
      "// conversionLineLen = 9\n" +
      "// baseLineLen = 26\n" +
      "// spanBLen = 52\n",
  },
  {
    id: "volume",
    name: "Volume",
    abbreviation: "Vol",
    category: "Volume",
    description: "Volume and volume-based confirmation values.",
    code: "// Volume template\n",
  },
];

let indicatorLibraryThumbnailIdsCache: Set<string> | null = null;
/** Signals → Indicators section (built-ins that are not Technical/Candlestick pattern cards). */
function getIndicatorLibraryThumbnailIds(): Set<string> {
  if (!indicatorLibraryThumbnailIdsCache) {
    indicatorLibraryThumbnailIdsCache = new Set(
      BUILTIN_INDICATORS.filter(
        (i) => i.signalGroup !== "TechnicalPattern" && i.signalGroup !== "Candlestick"
      ).map((i) => i.id)
    );
  }
  return indicatorLibraryThumbnailIdsCache;
}

// If a strategy has no stored indicator associations yet for the active mode,
// use a sensible starter set so the Journal indicators UI has something to show.
export const DEFAULT_STRATEGY_INDICATOR_IDS: string[] = [
  "rsi",
  "stoch_rsi",
  "macd",
  "bollinger",
  "money_flow",
  "roc",
  "ma",
  "ema",
  "sma",
  "fib_levels",
  "order_block_timeframe",
  "elliott_wave",
  "choch_bos_timeframe",
  "sfp",
  "fvg",
  "divergence",
  "supertrend",
  "ichimoku_cloud",
  "volume",
];

type StrategyIndicatorsMap = Record<string, Record<string, string[]>>; // mode -> strategyId -> indicatorIds
type JournalIndicatorValuesMap = Record<
  string,
  string
>; // `${mode}:${entryId}:${tradeIndex}:${phase}:${indicatorId}:${timeframe}` -> value

type JournalIndicatorDivergenceMap = Record<
  string,
  boolean
>; // `${mode}:${entryId}:${tradeIndex}:${phase}:${indicatorId}:${timeframe}` -> divergence true

type JournalIndicatorOtherSignalsMap = Record<
  string,
  Record<string, boolean | string>
>; // key `${mode}:${entryId}:${tradeIndex}:${phase}:${indicatorId}` or `...:${indicatorId}:${timeframe}` -> signalLabel -> checked or text

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function loadIndicators(): Indicator[] {
  const saved = safeParse<Indicator[]>(localStorage.getItem(INDICATORS_KEY), []).filter((i) => !!i && typeof i.id === "string");

  const merged: Indicator[] = [];

  // Always use the current code-defined built-ins (localStorage should only store custom indicators).
  // This prevents old cached built-in records (from earlier versions) from breaking category filters.
  for (const bi of BUILTIN_INDICATORS) {
    merged.push(
      withLibraryMeta({
        ...(bi as Omit<Indicator, "createdAt">),
        createdAt: 0,
        kind: "builtin",
      } as Indicator)
    );
  }

  // Add any user-added indicators not present in built-ins.
  for (const s of saved) {
    if (!BUILTIN_INDICATORS.some((bi) => bi.id === s.id)) {
      merged.push(
        withLibraryMeta({
          ...(s as Indicator),
          kind: "custom",
        } as Indicator)
      );
    }
  }

  return merged;
}

export function saveIndicators(indicators: Indicator[]) {
  localStorage.setItem(INDICATORS_KEY, JSON.stringify(indicators));
}

export function addIndicator(input: Omit<Indicator, "id" | "createdAt">): Indicator {
  // Custom indicator: mark as custom + give it a distinct accent color.
  const kind: Indicator["kind"] = "custom";
  const accentColor = input.accentColor ?? CUSTOM_ACCENT_COLOR;
  const indicatorId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const abbreviation = input.abbreviation.trim().toUpperCase();
  const providedImage = input.exampleImage && input.exampleImage.trim() ? input.exampleImage : undefined;
  const indicator: Indicator = {
    id: indicatorId,
    createdAt: Date.now(),
    kind,
    name: input.name.trim(),
    abbreviation,
    description: input.description.trim(),
    code: input.code,
    capturesTimeframes: input.capturesTimeframes === true,
    accentColor,
    exampleImage: providedImage ?? makeIndicatorExampleImageForId(indicatorId, abbreviation, accentColor, input.name.trim()),
    category: input.category ?? ("Custom" as const),
    otherSignals: Array.isArray(input.otherSignals) ? input.otherSignals : [],
  };
  const all = loadIndicators();
  saveIndicators([indicator, ...all]);
  return indicator;
}

export function updateIndicator(id: string, patch: Partial<Omit<Indicator, "id" | "createdAt">>) {
  const all = loadIndicators();
  const next = all.map((i) =>
    i.id === id
      ? {
          ...i,
          ...patch,
          name: patch.name != null ? patch.name : i.name,
          abbreviation: patch.abbreviation != null ? patch.abbreviation.toUpperCase() : i.abbreviation,
          description: patch.description != null ? patch.description : i.description,
          code: patch.code != null ? patch.code : i.code,
          // Treat "" as "auto" so we fall back to the generator on reload.
          exampleImage: patch.exampleImage === "" ? undefined : patch.exampleImage != null ? patch.exampleImage : i.exampleImage,
          accentColor: patch.accentColor != null ? patch.accentColor : i.accentColor,
          kind: patch.kind != null ? patch.kind : i.kind,
          category: patch.category ?? i.category,
          otherSignals: patch.otherSignals != null ? patch.otherSignals : i.otherSignals,
        }
      : i
  );
  saveIndicators(next);
}

export function getPrebuiltIndicatorThumbnails(abbreviation: string, accentColor: string = CUSTOM_ACCENT_COLOR) {
  const abbr = abbreviation.trim() ? abbreviation.trim().toUpperCase() : "IND";
  return BUILTIN_INDICATORS.map((i) => ({
    id: i.id,
    name: i.name,
    abbreviation: i.abbreviation,
    image: makeIndicatorExampleImageForId(i.id, abbr, accentColor, i.name),
  }));
}

const FAVORITE_INDICATORS_STORAGE_KEY = "tradebutler_favorite_indicators_v1";

function pruneJournalStorageKeysForIndicatorId(indicatorId: string) {
  if (typeof window === "undefined") return;

  const dropMatchingSegment = (storageKey: string) => {
    const data = safeParse<Record<string, unknown>>(localStorage.getItem(storageKey), {});
    let changed = false;
    for (const key of Object.keys(data)) {
      const parts = key.split(":");
      if (parts.length >= 5 && parts[4] === indicatorId) {
        delete data[key];
        changed = true;
      }
    }
    if (changed) localStorage.setItem(storageKey, JSON.stringify(data));
  };

  dropMatchingSegment(JOURNAL_INDICATOR_VALUES_KEY);
  dropMatchingSegment(JOURNAL_INDICATOR_DIVERGENCE_KEY);
  dropMatchingSegment(JOURNAL_INDICATOR_OTHER_SIGNALS_KEY);
  dropMatchingSegment(JOURNAL_INDICATOR_MA_FLAGS_KEY);

  const tradePatterns = safeParse<Record<string, string[]>>(localStorage.getItem(JOURNAL_TRADE_PATTERN_INDICATOR_IDS_KEY), {});
  let tpChanged = false;
  for (const [key, arr] of Object.entries(tradePatterns)) {
    if (!Array.isArray(arr)) continue;
    const filtered = arr.filter((x) => String(x) !== indicatorId);
    if (filtered.length !== arr.length) {
      tpChanged = true;
      if (filtered.length === 0) delete tradePatterns[key];
      else tradePatterns[key] = filtered;
    }
  }
  if (tpChanged) localStorage.setItem(JOURNAL_TRADE_PATTERN_INDICATOR_IDS_KEY, JSON.stringify(tradePatterns));
}

/**
 * Permanently removes a user-created indicator and related local preferences/journal drafts.
 * Built-in library indicators cannot be deleted.
 */
export function deleteIndicator(id: string): boolean {
  if (typeof window === "undefined") return false;
  const all = loadIndicators();
  const target = all.find((i) => i.id === id);
  if (!target || target.kind !== "custom") return false;

  saveIndicators(all.filter((i) => i.id !== id));

  try {
    let rawPrefs: Record<string, unknown> = {};
    const s = window.localStorage.getItem(INDICATOR_SIGNAL_PREFS_KEY);
    if (s) rawPrefs = JSON.parse(s) as Record<string, unknown>;
    if (rawPrefs[id]) {
      delete rawPrefs[id];
      window.localStorage.setItem(INDICATOR_SIGNAL_PREFS_KEY, JSON.stringify(rawPrefs));
    }
  } catch {
    /* optional */
  }

  try {
    const favRaw = window.localStorage.getItem(FAVORITE_INDICATORS_STORAGE_KEY);
    if (favRaw) {
      const arr = JSON.parse(favRaw) as unknown;
      if (Array.isArray(arr)) {
        const next = arr.map((x) => String(x)).filter((x) => x && x !== id);
        window.localStorage.setItem(FAVORITE_INDICATORS_STORAGE_KEY, JSON.stringify(next));
      }
    }
  } catch {
    /* optional */
  }

  pruneJournalStorageKeysForIndicatorId(id);

  window.dispatchEvent(new CustomEvent("tradebutler:indicator-signal-prefs-changed"));
  window.dispatchEvent(new CustomEvent("tradebutler:custom-indicators-changed"));
  return true;
}

export function loadStrategyIndicatorIds(mode: DataMode, strategyId: number): string[] {
  const data = safeParse<StrategyIndicatorsMap>(localStorage.getItem(STRATEGY_INDICATORS_KEY), {});
  const byMode = data[mode] ?? {};
  const stored = byMode[String(strategyId)];
  const indicatorIds = new Set(loadIndicators().map((i) => i.id));

  // Demo "Planestation's Strategy" (sandbox id 7): do not use the global default starter set.
  // Missing storage previously produced 19 generic signals instead of mirroring "My Strategy" after sync.
  if (mode === "sandbox" && strategyId === PLANESTATION_DEMO_STRATEGY_ID) {
    if (!Array.isArray(stored)) {
      return [];
    }
    return stored.filter((id) => indicatorIds.has(id));
  }

  if (Array.isArray(stored)) {
    const cleaned = stored.filter((id) => indicatorIds.has(id));
    return cleaned.length > 0 ? cleaned : DEFAULT_STRATEGY_INDICATOR_IDS;
  }

  return DEFAULT_STRATEGY_INDICATOR_IDS;
}

export function saveStrategyIndicatorIds(mode: DataMode, strategyId: number, indicatorIds: string[]) {
  const data = safeParse<StrategyIndicatorsMap>(localStorage.getItem(STRATEGY_INDICATORS_KEY), {});
  const byMode = data[mode] ?? {};
  byMode[String(strategyId)] = Array.from(new Set(indicatorIds));
  data[mode] = byMode;
  localStorage.setItem(STRATEGY_INDICATORS_KEY, JSON.stringify(data));
}

export type StrategyRuleType = "entry" | "takeProfit" | "custom";

type StrategyRuleIndicatorsMap = Record<
  DataMode,
  Record<
    string,
    Partial<Record<StrategyRuleType, string[]>>
  >
>;

function getDefaultStrategyRuleIndicatorsFallback(mode: DataMode, strategyId: number): string[] {
  // Back-compat: if rule-specific indicator sets aren't stored yet, fall back to the old
  // "Indicators for this strategy" selection.
  return loadStrategyIndicatorIds(mode, strategyId);
}

export function loadStrategyRuleIndicatorIds(mode: DataMode, strategyId: number, ruleType: StrategyRuleType): string[] {
  if (strategyId < 0) return [];
  const data = safeParse<StrategyRuleIndicatorsMap>(localStorage.getItem(STRATEGY_RULE_INDICATORS_KEY), {} as any);
  const byMode = data[mode] ?? {};
  const stored = byMode[String(strategyId)] ?? {};
  const ruleIds = stored?.[ruleType];

  const indicatorIds = new Set(loadIndicators().map((i) => i.id));
  const fallback = getDefaultStrategyRuleIndicatorsFallback(mode, strategyId);

  if (!Array.isArray(ruleIds)) return fallback;
  const cleaned = ruleIds.filter((id) => indicatorIds.has(id));
  return cleaned.length > 0 ? cleaned : fallback;
}

export function saveStrategyRuleIndicatorIds(mode: DataMode, strategyId: number, ruleType: StrategyRuleType, indicatorIds: string[]) {
  if (strategyId < 0) return;
  const data = safeParse<StrategyRuleIndicatorsMap>(localStorage.getItem(STRATEGY_RULE_INDICATORS_KEY), {} as any);
  const byMode = data[mode] ?? {};
  const entry = byMode[String(strategyId)] ?? {};
  entry[ruleType] = Array.from(new Set(indicatorIds));
  byMode[String(strategyId)] = entry;
  data[mode] = byMode;
  localStorage.setItem(STRATEGY_RULE_INDICATORS_KEY, JSON.stringify(data));
}

type StrategyRuleTextMap = Record<
  DataMode,
  Record<
    string,
    Partial<Record<StrategyRuleType, string[]>>
  >
>;

function sanitizeRuleTextRules(rules: string[]): string[] {
  return rules.map((r) => r.trim()).filter((r) => r.length > 0);
}

export function loadStrategyRuleTexts(mode: DataMode, strategyId: number, ruleType: StrategyRuleType): string[] {
  if (strategyId < 0) return [];

  const data = safeParse<StrategyRuleTextMap>(localStorage.getItem(STRATEGY_RULE_TEXT_KEY), {} as any);
  const byMode = data[mode] ?? {};
  const stored = byMode[String(strategyId)] ?? {};
  const ruleTexts = stored?.[ruleType];

  if (Array.isArray(ruleTexts)) {
    const cleaned = sanitizeRuleTextRules(ruleTexts).filter((r) => !/^Legacy indicator rule:/i.test(r.trim()));
    if (cleaned.length > 0) return cleaned;
  }

  return [];
}

export function saveStrategyRuleTexts(mode: DataMode, strategyId: number, ruleType: StrategyRuleType, rules: string[]) {
  if (strategyId < 0) return;
  const data = safeParse<StrategyRuleTextMap>(localStorage.getItem(STRATEGY_RULE_TEXT_KEY), {} as any);
  const byMode = data[mode] ?? {};
  const entry = byMode[String(strategyId)] ?? {};
  entry[ruleType] = sanitizeRuleTextRules(rules);
  byMode[String(strategyId)] = entry;
  data[mode] = byMode;
  localStorage.setItem(STRATEGY_RULE_TEXT_KEY, JSON.stringify(data));
}

export type StrategyCustomRuleSet = {
  id: string;
  title: string;
  rules: string[]; // ordered free-text rules
};

type StrategyCustomRuleSetsMap = Record<
  DataMode,
  Record<
    string,
    StrategyCustomRuleSet[]
  >
>;

function sanitizeCustomRuleSets(sets: StrategyCustomRuleSet[]): StrategyCustomRuleSet[] {
  const cleaned = sets
    .map((s) => ({
      id: (s.id ?? "").trim() || "",
      title: (s.title ?? "").trim() || "Custom Rules",
      rules: sanitizeRuleTextRules(Array.isArray(s.rules) ? s.rules : []),
    }))
    .filter((s) => s.id.length > 0);

  // Stable de-dup by id (preserve first occurrence).
  const seen = new Set<string>();
  const out: StrategyCustomRuleSet[] = [];
  for (const s of cleaned) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  return out;
}

/** Reads only persisted rule lines for a type (no legacy indicator placeholder synthesis). */
function loadStoredStrategyRuleTextsArrayOnly(
  mode: DataMode,
  strategyId: number,
  ruleType: StrategyRuleType
): string[] | undefined {
  if (strategyId < 0) return undefined;
  const data = safeParse<StrategyRuleTextMap>(localStorage.getItem(STRATEGY_RULE_TEXT_KEY), {} as any);
  const byMode = data[mode] ?? {};
  const stored = byMode[String(strategyId)] ?? {};
  const ruleTexts = stored?.[ruleType];
  if (!Array.isArray(ruleTexts)) return undefined;
  return sanitizeRuleTextRules(ruleTexts);
}

export function loadStrategyCustomRuleSets(mode: DataMode, strategyId: number): StrategyCustomRuleSet[] {
  if (strategyId < 0) return [];

  const data = safeParse<StrategyCustomRuleSetsMap>(localStorage.getItem(STRATEGY_CUSTOM_RULE_SETS_KEY), {} as any);
  const byMode = data[mode] ?? {};
  const raw = byMode[String(strategyId)];

  // Any explicit value (including []) means "use saved custom sets only" — do not resurrect legacy rows.
  if (raw !== undefined) {
    return sanitizeCustomRuleSets(Array.isArray(raw) ? raw : []);
  }

  // First load for this strategy: migrate only *explicitly stored* legacy "custom" lines (user/strategy data),
  // not indicator-derived placeholder text from loadStrategyRuleTexts.
  const explicitLegacy = loadStoredStrategyRuleTextsArrayOnly(mode, strategyId, "custom");
  if (explicitLegacy !== undefined && explicitLegacy.length > 0) {
    return [
      {
        id: `crs_mig_${mode}_${strategyId}`,
        title: "Custom Rules",
        rules: explicitLegacy,
      },
    ];
  }

  return [];
}

export function saveStrategyCustomRuleSets(mode: DataMode, strategyId: number, sets: StrategyCustomRuleSet[]) {
  if (strategyId < 0) return;

  const data = safeParse<StrategyCustomRuleSetsMap>(localStorage.getItem(STRATEGY_CUSTOM_RULE_SETS_KEY), {} as any);
  const byMode = data[mode] ?? {};
  byMode[String(strategyId)] = sanitizeCustomRuleSets(sets);
  data[mode] = byMode;
  localStorage.setItem(STRATEGY_CUSTOM_RULE_SETS_KEY, JSON.stringify(data));
}

export type IndicatorPhase = "entry" | "exit";

export type StrategyRulesEnabled = {
  entryRulesEnabled: boolean;
  takeProfitRulesEnabled: boolean;
};

type StrategyRulesEnabledMap = Record<
  DataMode,
  Record<
    string,
    {
      entryRulesEnabled?: boolean;
      takeProfitRulesEnabled?: boolean;
    }
  >
>;

export function loadStrategyRulesEnabled(mode: DataMode, strategyId: number): StrategyRulesEnabled {
  const data = safeParse<StrategyRulesEnabledMap>(localStorage.getItem(STRATEGY_RULES_ENABLED_KEY), {} as any);
  const byMode = data[mode] ?? {};
  const stored = byMode[String(strategyId)] ?? {};
  const entryRulesEnabled = typeof stored.entryRulesEnabled === "boolean" ? stored.entryRulesEnabled : true;
  const takeProfitRulesEnabled = typeof stored.takeProfitRulesEnabled === "boolean" ? stored.takeProfitRulesEnabled : true;
  return { entryRulesEnabled, takeProfitRulesEnabled };
}

export function saveStrategyRulesEnabled(mode: DataMode, strategyId: number, enabled: StrategyRulesEnabled) {
  if (strategyId < 0) return;
  const data = safeParse<StrategyRulesEnabledMap>(localStorage.getItem(STRATEGY_RULES_ENABLED_KEY), {} as any);
  const byMode = data[mode] ?? {};
  byMode[String(strategyId)] = {
    entryRulesEnabled: enabled.entryRulesEnabled,
    takeProfitRulesEnabled: enabled.takeProfitRulesEnabled,
  };
  data[mode] = byMode;
  localStorage.setItem(STRATEGY_RULES_ENABLED_KEY, JSON.stringify(data));
}

export function loadJournalIndicatorValue(
  mode: DataMode,
  entryId: number,
  tradeIndex: number,
  phase: IndicatorPhase,
  indicatorId: string,
  timeframe: string
): string {
  const data = safeParse<JournalIndicatorValuesMap>(localStorage.getItem(JOURNAL_INDICATOR_VALUES_KEY), {});
  const key = `${mode}:${entryId}:${tradeIndex}:${phase}:${indicatorId}:${timeframe}`;
  const id = indicatorId.toLowerCase();
  if (id === "ema" || id === "ma") {
    const cfg = loadMovingAverageLengthsConfig(id);
    const defaultsParts = cfg.map((c) => String(c.len));

    const stored = data[key];
    const rawParts =
      typeof stored === "string" && stored.trim().length > 0 ? stored.split(",").map((s) => s.trim()) : [];

    const mergedParts = defaultsParts.map((d, i) => {
      // If a length is disabled, force it back to its default value
      // (and therefore hide it in the Journal without requiring user input).
      if (!cfg[i]?.enabled) return d;
      const kind = cfg[i]?.journalKind ?? "value";
      const raw = rawParts[i];
      if (kind === "checkbox") {
        const on = raw === "1" || raw === "true" || raw === "yes" || raw === "on";
        return on ? "1" : "";
      }
      if (raw != null && raw !== "") return raw;
      return d;
    });

    return mergedParts.join(",");
  }

  const stored = data[key];
  if (typeof stored === "string" && stored.trim().length > 0) return stored;

  return "";
}

/**
 * Loads the exact stored indicator value (no EMA/MA default fallback).
 * Used for UI cases where we want inputs to start blank unless the user typed something.
 */
export function loadJournalIndicatorValueRaw(
  mode: DataMode,
  entryId: number,
  tradeIndex: number,
  phase: IndicatorPhase,
  indicatorId: string,
  timeframe: string
): string {
  const data = safeParse<JournalIndicatorValuesMap>(localStorage.getItem(JOURNAL_INDICATOR_VALUES_KEY), {});
  const key = `${mode}:${entryId}:${tradeIndex}:${phase}:${indicatorId}:${timeframe}`;
  return data[key] ?? "";
}

export function setJournalIndicatorValue(
  mode: DataMode,
  entryId: number,
  tradeIndex: number,
  phase: IndicatorPhase,
  indicatorId: string,
  timeframe: string,
  value: string
) {
  const data = safeParse<JournalIndicatorValuesMap>(localStorage.getItem(JOURNAL_INDICATOR_VALUES_KEY), {});
  const key = `${mode}:${entryId}:${tradeIndex}:${phase}:${indicatorId}:${timeframe}`;
  if (!value.trim()) {
    delete data[key];
  } else {
    data[key] = value;
  }
  localStorage.setItem(JOURNAL_INDICATOR_VALUES_KEY, JSON.stringify(data));
}

export function migrateJournalIndicatorDraftValues(mode: DataMode, fromEntryId: number, toEntryId: number) {
  const data = safeParse<JournalIndicatorValuesMap>(localStorage.getItem(JOURNAL_INDICATOR_VALUES_KEY), {});
  const prefix = `${mode}:${fromEntryId}:`;
  const newPrefix = `${mode}:${toEntryId}:`;
  let changed = false;
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith(prefix)) {
      delete data[key];
      const rest = key.slice(prefix.length);
      data[`${newPrefix}${rest}`] = value;
      changed = true;
    }
  }
  if (changed) {
    localStorage.setItem(JOURNAL_INDICATOR_VALUES_KEY, JSON.stringify(data));
  }
}

export function loadJournalIndicatorDivergence(
  mode: DataMode,
  entryId: number,
  tradeIndex: number,
  phase: IndicatorPhase,
  indicatorId: string,
  timeframe: string
): boolean {
  const data = safeParse<JournalIndicatorDivergenceMap>(localStorage.getItem(JOURNAL_INDICATOR_DIVERGENCE_KEY), {});
  const key = `${mode}:${entryId}:${tradeIndex}:${phase}:${indicatorId}:${timeframe}`;
  return !!data[key];
}

const EMA_MA_JOURNAL_ROW_VISIBILITY_KEY = "tradebutler_ema_ma_journal_row_visibility_v1";

/** Whether Crossing / Coiling rows appear in the Journal for EMA or MA (Signals modal). */
export type EmaMaJournalRowVisibility = { showCrossingRow: boolean; showCoilingRow: boolean };

export function loadEmaMaJournalRowVisibility(indicatorId: "ema" | "ma"): EmaMaJournalRowVisibility {
  const defaultVis: EmaMaJournalRowVisibility = { showCrossingRow: true, showCoilingRow: true };
  if (typeof window === "undefined") return defaultVis;
  try {
    const raw = window.localStorage.getItem(EMA_MA_JOURNAL_ROW_VISIBILITY_KEY);
    if (!raw?.trim()) return defaultVis;
    const parsed = JSON.parse(raw) as Record<string, Partial<EmaMaJournalRowVisibility>>;
    const cur = parsed[indicatorId];
    if (!cur || typeof cur !== "object") return defaultVis;
    return {
      showCrossingRow: typeof cur.showCrossingRow === "boolean" ? cur.showCrossingRow : true,
      showCoilingRow: typeof cur.showCoilingRow === "boolean" ? cur.showCoilingRow : true,
    };
  } catch {
    return defaultVis;
  }
}

export function saveEmaMaJournalRowVisibility(indicatorId: "ema" | "ma", vis: EmaMaJournalRowVisibility) {
  if (typeof window === "undefined") return;
  let all: Record<string, EmaMaJournalRowVisibility> = {};
  try {
    const raw = window.localStorage.getItem(EMA_MA_JOURNAL_ROW_VISIBILITY_KEY);
    if (raw?.trim()) all = JSON.parse(raw) as Record<string, EmaMaJournalRowVisibility>;
  } catch {
    all = {};
  }
  all[indicatorId] = vis;
  window.localStorage.setItem(EMA_MA_JOURNAL_ROW_VISIBILITY_KEY, JSON.stringify(all));
  window.dispatchEvent(new CustomEvent("tradebutler:ma-config-changed"));
}

export type JournalIndicatorMaFlags = { crossing: boolean; coiling: boolean };

type JournalIndicatorMaFlagsMap = Record<string, JournalIndicatorMaFlags>;

export function loadJournalIndicatorMaFlags(
  mode: DataMode,
  entryId: number,
  tradeIndex: number,
  phase: IndicatorPhase,
  indicatorId: string,
  timeframe: string
): JournalIndicatorMaFlags {
  const data = safeParse<JournalIndicatorMaFlagsMap>(localStorage.getItem(JOURNAL_INDICATOR_MA_FLAGS_KEY), {});
  const key = `${mode}:${entryId}:${tradeIndex}:${phase}:${indicatorId}:${timeframe}`;
  const stored = data[key];
  if (stored && typeof stored === "object") {
    return { crossing: !!(stored as any).crossing, coiling: !!(stored as any).coiling };
  }

  // Back-compat: older builds stored global per-indicator flags (not per timeframe).
  try {
    const legacyKey = `tradebutler_${indicatorId}_crossing_coiling_flags_v1`;
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(legacyKey) : null;
    if (!raw) return { crossing: false, coiling: false };
    const parsed = JSON.parse(raw);
    const crossing = Boolean(parsed?.crossing) || Boolean(parsed?.bullishCross) || Boolean(parsed?.bearishCross);
    return { crossing, coiling: Boolean(parsed?.coiling) };
  } catch {
    return { crossing: false, coiling: false };
  }
}

export function setJournalIndicatorMaFlags(
  mode: DataMode,
  entryId: number,
  tradeIndex: number,
  phase: IndicatorPhase,
  indicatorId: string,
  timeframe: string,
  flags: JournalIndicatorMaFlags
) {
  const data = safeParse<JournalIndicatorMaFlagsMap>(localStorage.getItem(JOURNAL_INDICATOR_MA_FLAGS_KEY), {});
  const key = `${mode}:${entryId}:${tradeIndex}:${phase}:${indicatorId}:${timeframe}`;
  const clean: JournalIndicatorMaFlags = { crossing: !!flags.crossing, coiling: !!flags.coiling };
  if (!clean.crossing && !clean.coiling) {
    delete data[key];
  } else {
    data[key] = clean;
  }
  localStorage.setItem(JOURNAL_INDICATOR_MA_FLAGS_KEY, JSON.stringify(data));
}

export function setJournalIndicatorDivergence(
  mode: DataMode,
  entryId: number,
  tradeIndex: number,
  phase: IndicatorPhase,
  indicatorId: string,
  timeframe: string,
  divergence: boolean
) {
  const data = safeParse<JournalIndicatorDivergenceMap>(localStorage.getItem(JOURNAL_INDICATOR_DIVERGENCE_KEY), {});
  const key = `${mode}:${entryId}:${tradeIndex}:${phase}:${indicatorId}:${timeframe}`;
  if (divergence) data[key] = true;
  else delete data[key];
  localStorage.setItem(JOURNAL_INDICATOR_DIVERGENCE_KEY, JSON.stringify(data));
}

export function migrateJournalIndicatorDraftDivergence(mode: DataMode, fromEntryId: number, toEntryId: number) {
  const data = safeParse<JournalIndicatorDivergenceMap>(localStorage.getItem(JOURNAL_INDICATOR_DIVERGENCE_KEY), {});
  const prefix = `${mode}:${fromEntryId}:`;
  const newPrefix = `${mode}:${toEntryId}:`;
  let changed = false;
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith(prefix)) {
      delete data[key];
      const rest = key.slice(prefix.length);
      data[`${newPrefix}${rest}`] = value;
      changed = true;
    }
  }
  if (changed) {
    localStorage.setItem(JOURNAL_INDICATOR_DIVERGENCE_KEY, JSON.stringify(data));
  }
}

export function loadJournalIndicatorOtherSignals(
  mode: DataMode,
  entryId: number,
  tradeIndex: number,
  phase: IndicatorPhase,
  indicatorId: string,
  timeframe: string
): Record<string, boolean | string> {
  const data = safeParse<JournalIndicatorOtherSignalsMap>(localStorage.getItem(JOURNAL_INDICATOR_OTHER_SIGNALS_KEY), {});
  const keyTf = `${mode}:${entryId}:${tradeIndex}:${phase}:${indicatorId}:${timeframe}`;
  const keyLegacy = `${mode}:${entryId}:${tradeIndex}:${phase}:${indicatorId}`;
  return data[keyTf] ?? data[keyLegacy] ?? {};
}

export function setJournalIndicatorOtherSignalField(
  mode: DataMode,
  entryId: number,
  tradeIndex: number,
  phase: IndicatorPhase,
  indicatorId: string,
  timeframe: string,
  signalLabel: string,
  value: boolean | string
) {
  const clean = signalLabel.trim();
  if (!clean) return;
  const data = safeParse<JournalIndicatorOtherSignalsMap>(localStorage.getItem(JOURNAL_INDICATOR_OTHER_SIGNALS_KEY), {});
  const key = `${mode}:${entryId}:${tradeIndex}:${phase}:${indicatorId}:${timeframe}`;
  const cur: Record<string, boolean | string> = { ...(data[key] ?? {}) };
  if (typeof value === "boolean") {
    cur[clean] = value;
  } else {
    const t = value.trim();
    if (!t) delete cur[clean];
    else cur[clean] = value;
  }
  data[key] = cur;
  localStorage.setItem(JOURNAL_INDICATOR_OTHER_SIGNALS_KEY, JSON.stringify(data));
}

export function setJournalIndicatorOtherSignal(
  mode: DataMode,
  entryId: number,
  tradeIndex: number,
  phase: IndicatorPhase,
  indicatorId: string,
  timeframe: string,
  signalLabel: string,
  checked: boolean
) {
  setJournalIndicatorOtherSignalField(mode, entryId, tradeIndex, phase, indicatorId, timeframe, signalLabel, checked);
}

export function migrateJournalIndicatorDraftOtherSignals(
  mode: DataMode,
  fromEntryId: number,
  toEntryId: number
) {
  const data = safeParse<JournalIndicatorOtherSignalsMap>(localStorage.getItem(JOURNAL_INDICATOR_OTHER_SIGNALS_KEY), {});
  const prefix = `${mode}:${fromEntryId}:`;
  const newPrefix = `${mode}:${toEntryId}:`;
  let changed = false;
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith(prefix)) {
      delete data[key];
      const rest = key.slice(prefix.length);
      data[`${newPrefix}${rest}`] = value;
      changed = true;
    }
  }
  if (changed) {
    localStorage.setItem(JOURNAL_INDICATOR_OTHER_SIGNALS_KEY, JSON.stringify(data));
  }
}

export function loadJournalTradePatternIndicatorIds(
  mode: DataMode,
  entryId: number,
  tradeIndex: number,
  phase: IndicatorPhase
): string[] {
  const data = safeParse<Record<string, string[]>>(localStorage.getItem(JOURNAL_TRADE_PATTERN_INDICATOR_IDS_KEY), {});
  const key = `${mode}:${entryId}:${tradeIndex}:${phase}:pattern_indicator_ids`;
  const arr = data[key];
  if (!Array.isArray(arr)) return [];
  return arr.map((x) => String(x)).filter(Boolean);
}

export function setJournalTradePatternIndicatorIds(
  mode: DataMode,
  entryId: number,
  tradeIndex: number,
  phase: IndicatorPhase,
  indicatorIds: string[]
) {
  const cleaned = indicatorIds.map((x) => x.trim()).filter(Boolean);
  const data = safeParse<Record<string, string[]>>(localStorage.getItem(JOURNAL_TRADE_PATTERN_INDICATOR_IDS_KEY), {});
  const key = `${mode}:${entryId}:${tradeIndex}:${phase}:pattern_indicator_ids`;
  if (cleaned.length === 0) {
    delete data[key];
  } else {
    data[key] = Array.from(new Set(cleaned));
  }
  localStorage.setItem(JOURNAL_TRADE_PATTERN_INDICATOR_IDS_KEY, JSON.stringify(data));
}

export function migrateJournalIndicatorDraftTradePatterns(
  mode: DataMode,
  fromEntryId: number,
  toEntryId: number
) {
  const data = safeParse<Record<string, string[]>>(localStorage.getItem(JOURNAL_TRADE_PATTERN_INDICATOR_IDS_KEY), {});
  const prefix = `${mode}:${fromEntryId}:`;
  const newPrefix = `${mode}:${toEntryId}:`;
  let changed = false;
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith(prefix)) {
      delete data[key];
      const rest = key.slice(prefix.length);
      data[`${newPrefix}${rest}`] = value;
      changed = true;
    }
  }
  if (changed) {
    localStorage.setItem(JOURNAL_TRADE_PATTERN_INDICATOR_IDS_KEY, JSON.stringify(data));
  }
}

