import type { DataMode } from "./dataMode";

export interface Indicator {
  id: string; // uuid-ish
  name: string;
  abbreviation: string; // shown in strategy/journal UI
  description: string;
  code: string;
  createdAt: number;
}

const INDICATORS_KEY = "tradebutler_indicators_v1";
const STRATEGY_INDICATORS_KEY = "tradebutler_strategy_indicators_v1";
const JOURNAL_INDICATOR_VALUES_KEY = "tradebutler_journal_indicator_values_v1";

type StrategyIndicatorsMap = Record<string, Record<string, string[]>>; // mode -> strategyId -> indicatorIds
type JournalIndicatorValuesMap = Record<
  string,
  string
>; // `${mode}:${entryId}:${tradeIndex}:${phase}:${indicatorId}:${timeframe}` -> value

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function loadIndicators(): Indicator[] {
  return safeParse<Indicator[]>(localStorage.getItem(INDICATORS_KEY), []).filter(
    (i) => !!i && typeof i.id === "string"
  );
}

export function saveIndicators(indicators: Indicator[]) {
  localStorage.setItem(INDICATORS_KEY, JSON.stringify(indicators));
}

export function addIndicator(input: Omit<Indicator, "id" | "createdAt">): Indicator {
  const indicator: Indicator = {
    id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
    createdAt: Date.now(),
    name: input.name.trim(),
    abbreviation: input.abbreviation.trim().toUpperCase(),
    description: input.description.trim(),
    code: input.code,
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
        }
      : i
  );
  saveIndicators(next);
}

export function deleteIndicator(id: string) {
  saveIndicators(loadIndicators().filter((i) => i.id !== id));
}

export function loadStrategyIndicatorIds(mode: DataMode, strategyId: number): string[] {
  const data = safeParse<StrategyIndicatorsMap>(localStorage.getItem(STRATEGY_INDICATORS_KEY), {});
  return data[mode]?.[String(strategyId)] ?? [];
}

export function saveStrategyIndicatorIds(mode: DataMode, strategyId: number, indicatorIds: string[]) {
  const data = safeParse<StrategyIndicatorsMap>(localStorage.getItem(STRATEGY_INDICATORS_KEY), {});
  const byMode = data[mode] ?? {};
  byMode[String(strategyId)] = Array.from(new Set(indicatorIds));
  data[mode] = byMode;
  localStorage.setItem(STRATEGY_INDICATORS_KEY, JSON.stringify(data));
}

export type IndicatorPhase = "entry" | "exit";

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

