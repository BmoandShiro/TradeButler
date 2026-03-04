import {
  EXAMPLE_TRADES,
  EXAMPLE_STRATEGIES,
  EXAMPLE_JOURNAL_ENTRIES,
  EXAMPLE_JOURNAL_TRADES,
  EXAMPLE_EMOTIONAL_STATES,
  EXAMPLE_JOURNAL_ENTRY_PAIRS,
  ExampleTrade,
  ExampleStrategy,
  ExampleJournalEntry,
  ExampleJournalTrade,
  ExampleEmotionalState,
} from "../exampleData";
import {
  SANDBOX_STRATEGY_CHECKLIST_ITEMS,
  SANDBOX_STRATEGY_SURVEY_METRICS,
} from "../data/sandboxStrategySeed";

const STORAGE_KEY = "tradebutler_sandbox_store_v2";
const LEGACY_KEY = "tradebutler_sandbox_store_v1";
const EXAMPLE_STORE_KEY = "tradebutler_example_store_v1";

export interface SandboxEmotionalState extends ExampleEmotionalState {
  journal_entry_id?: number | null;
  journal_trade_id?: number | null;
  journal_entry_ids?: string | null;
  trade_ids?: string | null;
}

export interface SandboxStoreState {
  trades: ExampleTrade[];
  strategies: ExampleStrategy[];
  journalEntries: ExampleJournalEntry[];
  journalTrades: ExampleJournalTrade[];
  emotionalStates: SandboxEmotionalState[];
  /** journal_entry_id -> array of { entry_trade_id, exit_trade_id } */
  journalEntryPairs: Record<number, { entry_trade_id: number; exit_trade_id: number }[]>;
}

function nextId(items: { id: number }[]): number {
  if (!items.length) return 1;
  return Math.max(...items.map((i) => i.id)) + 1;
}

function getSeedState(): SandboxStoreState {
  return {
    trades: EXAMPLE_TRADES.map((t) => ({ ...t })),
    strategies: EXAMPLE_STRATEGIES.map((s) => ({ ...s })),
    journalEntries: EXAMPLE_JOURNAL_ENTRIES.map((e) => ({ ...e })),
    journalTrades: EXAMPLE_JOURNAL_TRADES.map((t) => ({ ...t, r_multiple: (t as ExampleJournalTrade).r_multiple ?? null })),
    emotionalStates: EXAMPLE_EMOTIONAL_STATES.map((s) => ({
      ...s,
      journal_entry_id: null,
      journal_trade_id: null,
      journal_entry_ids: null,
      trade_ids: null,
    })) as SandboxEmotionalState[],
    journalEntryPairs: { ...EXAMPLE_JOURNAL_ENTRY_PAIRS },
  };
}

export function loadSandboxState(): SandboxStoreState {
  if (typeof window === "undefined") return getSeedState();
  try {
    let raw = window.localStorage.getItem(STORAGE_KEY);
    const legacyRaw = window.localStorage.getItem(LEGACY_KEY) || window.localStorage.getItem(EXAMPLE_STORE_KEY);
    if (!raw && legacyRaw) {
      const seed = getSeedState();
      saveSandboxState(seed);
      return seed;
    }
    if (!raw) return getSeedState();
    const parsed = JSON.parse(raw) as SandboxStoreState & { version?: number };
    if (!parsed.trades || !parsed.strategies) return getSeedState();
    if (!Array.isArray(parsed.journalEntries)) parsed.journalEntries = getSeedState().journalEntries;
    if (!Array.isArray(parsed.journalTrades)) parsed.journalTrades = getSeedState().journalTrades;
    if (!Array.isArray(parsed.emotionalStates)) parsed.emotionalStates = getSeedState().emotionalStates;
    if (!parsed.journalEntryPairs || typeof parsed.journalEntryPairs !== "object") parsed.journalEntryPairs = getSeedState().journalEntryPairs;
    return parsed;
  } catch {
    return getSeedState();
  }
}

export function saveSandboxState(state: SandboxStoreState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent("tradeButlerSandboxChanged"));
}

export function resetSandboxState() {
  saveSandboxState(getSeedState());
}

// ---- Trades ----
export interface NewSandboxTradeInput {
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  timestamp: string;
  order_type: string;
  fees: number | null;
  notes: string | null;
  strategy_id: number | null;
}

export function addSandboxTrade(input: NewSandboxTradeInput): ExampleTrade {
  const state = loadSandboxState();
  const id = nextId(state.trades);
  const trade: ExampleTrade = {
    id,
    symbol: input.symbol,
    side: input.side,
    quantity: input.quantity,
    price: input.price,
    timestamp: input.timestamp,
    order_type: input.order_type,
    status: "FILLED",
    fees: input.fees,
    notes: input.notes,
    strategy_id: input.strategy_id,
  };
  saveSandboxState({ ...state, trades: [trade, ...state.trades] });
  return trade;
}

export function deleteSandboxTrade(id: number) {
  const state = loadSandboxState();
  saveSandboxState({ ...state, trades: state.trades.filter((t) => t.id !== id) });
}

export function updateSandboxTradeStrategy(tradeId: number, strategyId: number | null) {
  const state = loadSandboxState();
  saveSandboxState({
    ...state,
    trades: state.trades.map((t) => (t.id === tradeId ? { ...t, strategy_id: strategyId } : t)),
  });
}

// ---- Strategies ----
export function getSandboxStrategies(): ExampleStrategy[] {
  return loadSandboxState().strategies;
}

export function addSandboxStrategy(input: { name: string; description?: string | null; notes?: string | null; color?: string | null }): ExampleStrategy {
  const state = loadSandboxState();
  const id = nextId(state.strategies);
  const strategy: ExampleStrategy = {
    id,
    name: input.name,
    description: input.description ?? null,
    notes: input.notes ?? null,
    created_at: new Date().toISOString(),
    color: input.color ?? null,
  };
  saveSandboxState({ ...state, strategies: [...state.strategies, strategy] });
  return strategy;
}

export function updateSandboxStrategy(id: number, input: { name?: string; description?: string | null; notes?: string | null; color?: string | null }) {
  const state = loadSandboxState();
  saveSandboxState({
    ...state,
    strategies: state.strategies.map((s) =>
      s.id === id
        ? {
            ...s,
            name: input.name ?? s.name,
            description: input.description !== undefined ? input.description : s.description,
            notes: input.notes !== undefined ? input.notes : s.notes,
            color: input.color !== undefined ? input.color : s.color,
          }
        : s
    ),
  });
}

export function deleteSandboxStrategy(id: number) {
  const state = loadSandboxState();
  saveSandboxState({
    ...state,
    strategies: state.strategies.filter((s) => s.id !== id),
    trades: state.trades.map((t) => (t.strategy_id === id ? { ...t, strategy_id: null } : t)),
  });
}

// ---- Journal ----
export function getSandboxJournalEntries(): ExampleJournalEntry[] {
  return loadSandboxState().journalEntries;
}

export function getSandboxJournalEntry(id: number): ExampleJournalEntry | null {
  return loadSandboxState().journalEntries.find((e) => e.id === id) ?? null;
}

export function getSandboxJournalTrades(entryId: number): ExampleJournalTrade[] {
  return loadSandboxState().journalTrades.filter((t) => t.journal_entry_id === entryId).sort((a, b) => a.trade_order - b.trade_order);
}

export function getSandboxAllJournalTrades(): ExampleJournalTrade[] {
  return loadSandboxState().journalTrades;
}

export function createSandboxJournalEntry(input: { date: string; title: string; strategy_id: number | null; linked_trade_ids?: string | null }): number {
  const state = loadSandboxState();
  const id = nextId(state.journalEntries);
  const now = new Date().toISOString();
  const entry: ExampleJournalEntry = {
    id,
    date: input.date,
    title: input.title,
    strategy_id: input.strategy_id,
    created_at: now,
    updated_at: now,
    linked_trade_ids: input.linked_trade_ids ?? null,
  };
  saveSandboxState({ ...state, journalEntries: [...state.journalEntries, entry] });
  return id;
}

export function updateSandboxJournalEntry(
  id: number,
  input: { date?: string; title?: string; strategy_id?: number | null; linked_trade_ids?: string | null }
) {
  const state = loadSandboxState();
  const now = new Date().toISOString();
  saveSandboxState({
    ...state,
    journalEntries: state.journalEntries.map((e) =>
      e.id === id
        ? {
            ...e,
            date: input.date ?? e.date,
            title: input.title ?? e.title,
            strategy_id: input.strategy_id !== undefined ? input.strategy_id : e.strategy_id,
            linked_trade_ids: input.linked_trade_ids !== undefined ? input.linked_trade_ids : e.linked_trade_ids,
            updated_at: now,
          }
        : e
    ),
  });
}

export function deleteSandboxJournalEntry(id: number) {
  const state = loadSandboxState();
  const pairs = { ...state.journalEntryPairs };
  delete pairs[id];
  saveSandboxState({
    ...state,
    journalEntries: state.journalEntries.filter((e) => e.id !== id),
    journalTrades: state.journalTrades.filter((t) => t.journal_entry_id !== id),
    emotionalStates: state.emotionalStates.map((s) =>
      s.journal_entry_id === id ? { ...s, journal_entry_id: null, journal_entry_ids: null } : s
    ),
    journalEntryPairs: pairs,
  });
}

export function createSandboxJournalTrade(
  entryId: number,
  input: Partial<Omit<ExampleJournalTrade, "id" | "journal_entry_id" | "created_at" | "updated_at">>
): number {
  const state = loadSandboxState();
  const id = nextId(state.journalTrades);
  const maxOrder = Math.max(0, ...state.journalTrades.filter((t) => t.journal_entry_id === entryId).map((t) => t.trade_order));
  const now = new Date().toISOString();
  const inp = input as ExampleJournalTrade & { r_multiple?: number | null };
  const trade: ExampleJournalTrade = {
    id,
    journal_entry_id: entryId,
    symbol: input.symbol ?? null,
    position: input.position ?? null,
    timeframe: input.timeframe ?? null,
    entry_type: input.entry_type ?? null,
    exit_type: input.exit_type ?? null,
    trade: input.trade ?? null,
    what_went_well: input.what_went_well ?? null,
    what_could_be_improved: input.what_could_be_improved ?? null,
    emotional_state: input.emotional_state ?? null,
    notes: input.notes ?? null,
    outcome: input.outcome ?? null,
    r_multiple: inp.r_multiple ?? null,
    trade_order: input.trade_order ?? maxOrder + 1,
    created_at: now,
    updated_at: now,
  };
  saveSandboxState({ ...state, journalTrades: [...state.journalTrades, trade] });
  return id;
}

export function updateSandboxJournalTrade(
  id: number,
  input: Partial<Omit<ExampleJournalTrade, "id" | "journal_entry_id" | "created_at">>
) {
  const state = loadSandboxState();
  const now = new Date().toISOString();
  saveSandboxState({
    ...state,
    journalTrades: state.journalTrades.map((t) =>
      t.id === id ? { ...t, ...input, updated_at: now } as ExampleJournalTrade : t
    ),
  });
}

export function deleteSandboxJournalTrade(id: number) {
  const state = loadSandboxState();
  saveSandboxState({
    ...state,
    journalTrades: state.journalTrades.filter((t) => t.id !== id),
    emotionalStates: state.emotionalStates.map((s) => (s.journal_trade_id === id ? { ...s, journal_trade_id: null } : s)),
  });
}

export function getSandboxJournalEntryPairs(entryId: number): { entry_trade_id: number; exit_trade_id: number }[] {
  return loadSandboxState().journalEntryPairs[entryId] ?? [];
}

/** Returns full paired-trade shape for Journal page (symbol, prices, pnl, etc.) */
export function getSandboxJournalEntryPairsAsPairedTrades(entryId: number): Array<{
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
}> {
  const state = loadSandboxState();
  const rawPairs = state.journalEntryPairs[entryId] ?? [];
  const tradeMap = new Map(state.trades.map((t) => [t.id, t]));
  return rawPairs.map(({ entry_trade_id, exit_trade_id }) => {
    const entryT = tradeMap.get(entry_trade_id);
    const exitT = tradeMap.get(exit_trade_id);
    if (!entryT || !exitT) return null;
    const qty = Math.min(entryT.quantity, exitT.quantity);
    const gross = (exitT.price - entryT.price) * qty * (entryT.side.toUpperCase() === "BUY" ? 1 : -1);
    const entryFees = entryT.fees ?? 0;
    const exitFees = exitT.fees ?? 0;
    return {
      symbol: entryT.symbol,
      entry_trade_id,
      exit_trade_id,
      quantity: qty,
      entry_price: entryT.price,
      exit_price: exitT.price,
      entry_timestamp: entryT.timestamp,
      exit_timestamp: exitT.timestamp,
      gross_profit_loss: gross,
      entry_fees: entryFees,
      exit_fees: exitFees,
      net_profit_loss: gross - entryFees - exitFees,
      strategy_id: entryT.strategy_id,
      notes: exitT.notes ?? null,
    };
  }).filter(Boolean) as Array<{
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
  }>;
}

export function setSandboxJournalEntryPairs(entryId: number, pairs: { entry_trade_id: number; exit_trade_id: number }[]) {
  const state = loadSandboxState();
  saveSandboxState({
    ...state,
    journalEntryPairs: { ...state.journalEntryPairs, [entryId]: pairs },
  });
}

// ---- Emotional states ----
export function getSandboxEmotionalStates(): SandboxEmotionalState[] {
  return loadSandboxState().emotionalStates;
}

export function getSandboxEmotionalStatesForJournal(entryId: number): SandboxEmotionalState[] {
  const states = loadSandboxState().emotionalStates;
  return states.filter(
    (s) =>
      s.journal_entry_id === entryId ||
      (s.journal_entry_ids && JSON.parse(s.journal_entry_ids || "[]").includes(entryId))
  );
}

export function addSandboxEmotionalState(input: {
  timestamp: string;
  emotion: string;
  intensity: number;
  notes?: string | null;
  trade_id?: number | null;
  journal_entry_id?: number | null;
  journal_trade_id?: number | null;
  journal_entry_ids?: string | null;
  trade_ids?: string | null;
}): number {
  const state = loadSandboxState();
  const id = nextId(state.emotionalStates);
  const newState: SandboxEmotionalState = {
    id,
    timestamp: input.timestamp,
    emotion: input.emotion,
    intensity: input.intensity,
    notes: input.notes ?? null,
    trade_id: input.trade_id ?? null,
    journal_entry_id: input.journal_entry_id ?? null,
    journal_trade_id: input.journal_trade_id ?? null,
    journal_entry_ids: input.journal_entry_ids ?? null,
    trade_ids: input.trade_ids ?? null,
  };
  saveSandboxState({ ...state, emotionalStates: [...state.emotionalStates, newState] });
  return id;
}

export function updateSandboxEmotionalState(
  id: number,
  input: Partial<Omit<SandboxEmotionalState, "id">>
) {
  const state = loadSandboxState();
  saveSandboxState({
    ...state,
    emotionalStates: state.emotionalStates.map((s) => (s.id === id ? { ...s, ...input } : s)),
  });
}

export function deleteSandboxEmotionalState(id: number) {
  const state = loadSandboxState();
  saveSandboxState({ ...state, emotionalStates: state.emotionalStates.filter((s) => s.id !== id) });
}

export function addSandboxJournalEntryToEmotionalStates(entryId: number, stateIds: number[]) {
  const state = loadSandboxState();
  saveSandboxState({
    ...state,
    emotionalStates: state.emotionalStates.map((s) => {
      if (!stateIds.includes(s.id)) return s;
      const ids = s.journal_entry_ids ? JSON.parse(s.journal_entry_ids) : [];
      if (ids.includes(entryId)) return s;
      return { ...s, journal_entry_ids: JSON.stringify([...ids, entryId]) };
    }),
  });
}

export function removeSandboxJournalEntryFromEmotionalStates(entryId: number, stateIds: number[]) {
  const state = loadSandboxState();
  saveSandboxState({
    ...state,
    emotionalStates: state.emotionalStates.map((s) => {
      if (!stateIds.includes(s.id)) return s;
      const ids = (s.journal_entry_ids ? JSON.parse(s.journal_entry_ids) : []).filter((id: number) => id !== entryId);
      return { ...s, journal_entry_ids: ids.length ? JSON.stringify(ids) : null };
    }),
  });
}

export function linkSandboxEmotionalStatesToJournal(emotionalStateIds: number[], journalEntryId: number, journalTradeId?: number) {
  const state = loadSandboxState();
  saveSandboxState({
    ...state,
    emotionalStates: state.emotionalStates.map((s) => {
      if (!emotionalStateIds.includes(s.id)) return s;
      return {
        ...s,
        journal_entry_id: journalEntryId,
        journal_trade_id: journalTradeId ?? null,
        journal_entry_ids: JSON.stringify([journalEntryId]),
      };
    }),
  });
}

// ---- Strategy checklists & survey metrics (sandbox seed; read-only for demos) ----
export function getSandboxStrategyChecklist(strategyId: number) {
  return SANDBOX_STRATEGY_CHECKLIST_ITEMS.filter((i) => i.strategy_id === strategyId);
}

export function getSandboxStrategySurveyMetricsWithValues(strategyId: number) {
  return SANDBOX_STRATEGY_SURVEY_METRICS.filter((m) => m.strategy_id === strategyId);
}

export function getSandboxStrategyChecklistItemMetrics(strategyId: number) {
  const items = SANDBOX_STRATEGY_CHECKLIST_ITEMS.filter((i) => i.strategy_id === strategyId && i.checklist_type !== "survey");
  return items.map((i) => ({
    checklist_item_id: i.id,
    item_text: i.item_text,
    checklist_type: i.checklist_type,
    times_checked: 12 + (i.id % 5),
    avg_performance: 1.2 + (i.id % 3) * 0.5,
    performance_kind: "r_multiple",
  }));
}

export function getSandboxCustomSurveyMetrics(strategyId: number) {
  const items = SANDBOX_STRATEGY_CHECKLIST_ITEMS.filter((i) => i.strategy_id === strategyId && i.checklist_type === "survey");
  return items.map((i) => ({
    checklist_item_id: i.id,
    item_text: i.item_text,
    response_count: 24 + (i.id % 10),
    avg_value: 3 + (i.id % 3) * 0.5,
  }));
}
